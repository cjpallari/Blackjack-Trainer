import { pointRank, pointRankLabel, type Card, type PointRank } from "../blackjack/cards";
import { handActions, type PlayerHand } from "../blackjack/engine";
import { handValue, isBlackjack, isPair } from "../blackjack/hand";
import { randomInt, type Rng } from "../blackjack/rng";
import type { TableRules } from "../blackjack/rules";
import { buildCards } from "../blackjack/shoe";
import { evaluateDecision, strategyTableFor, type PlayerAction, type StrategyAdvice } from "../blackjack/strategy";

export type BSMode = "all" | "hard" | "soft" | "pairs" | "missed";
export type UpcardFilter = "any" | "weak" | "strong";

export interface BSOptions {
  mode: BSMode;
  upcards: UpcardFilter;
  /** Skip hands with no real decision (hard 5–7, hard 18+, soft 20). */
  skipTrivial: boolean;
}

export const DEFAULT_BS_OPTIONS: BSOptions = { mode: "all", upcards: "any", skipTrivial: true };

export interface BSScenario {
  readonly player: readonly Card[];
  readonly dealerUp: Card;
  readonly available: readonly PlayerAction[];
  readonly advice: StrategyAdvice;
  /** Stable key for tracking misses, e.g. "hard 16|10". */
  readonly key: string;
}

export function scenarioKey(row: string, up: PointRank): string {
  return `${row}|${pointRankLabel(up)}`;
}

export function parseScenarioKey(key: string): { row: string; up: string } {
  const [row, up] = key.split("|");
  return { row, up };
}

function upcardMatches(up: PointRank, f: UpcardFilter): boolean {
  if (f === "weak") return up >= 2 && up <= 6;
  if (f === "strong") return up === 1 || up >= 7;
  return true;
}

function categoryOf(cards: readonly Card[]): "hard" | "soft" | "pairs" {
  if (isPair(cards)) return "pairs";
  return handValue(cards).soft ? "soft" : "hard";
}

function isTrivial(cards: readonly Card[]): boolean {
  if (isPair(cards)) return false;
  const v = handValue(cards);
  if (v.soft) return v.total >= 20;
  return v.total <= 7 || v.total >= 18;
}

function buildScenario(player: Card[], dealerUp: Card, rules: TableRules): BSScenario {
  const hand: PlayerHand = {
    cards: player,
    bet: 1,
    fromSplit: false,
    isSplitAces: false,
    doubled: false,
    surrendered: false,
    done: false,
  };
  const available = handActions(rules, hand, 1);
  const up = pointRank(dealerUp.rank);
  const advice = evaluateDecision(strategyTableFor(rules), rules, {
    cards: player.map((c) => pointRank(c.rank)),
    up,
    available,
  });
  return { player, dealerUp, available, advice, key: scenarioKey(advice.row, up) };
}

/** First `n` cards of a Fisher–Yates shuffle, without shuffling the whole shoe. */
function sampleWithoutReplacement<T>(items: readonly T[], n: number, rng: Rng): T[] {
  const pool = items.slice();
  for (let i = 0; i < n; i++) {
    const j = i + randomInt(rng, pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/**
 * Deal a realistic training hand: player two cards and dealer upcard drawn
 * without replacement from a freshly shuffled shoe of the configured size.
 * Category filters use rejection sampling, so hand frequencies within a
 * category stay realistic. Player naturals are skipped (no decision), and
 * with an Ace/Ten up we assume the dealer has already peeked.
 */
export function generateScenario(rules: TableRules, opts: BSOptions, rng: Rng, missedKeys: readonly string[] = []): BSScenario {
  const targetKeys = opts.mode === "missed" ? new Set(missedKeys) : null;
  const cards = buildCards(rules.decks);
  for (let attempt = 0; attempt < 20000; attempt++) {
    const [a, u, b] = sampleWithoutReplacement(cards, 3, rng); // deal order: player, dealer, player
    const player = [a, b];
    const up = pointRank(u.rank);
    if (isBlackjack(player)) continue;
    if (!upcardMatches(up, opts.upcards)) continue;
    if (opts.mode !== "all" && opts.mode !== "missed" && categoryOf(player) !== opts.mode) continue;
    if (opts.skipTrivial && opts.mode !== "missed" && isTrivial(player)) continue;
    const scenario = buildScenario(player, u, rules);
    if (targetKeys && targetKeys.size > 0 && !targetKeys.has(scenario.key)) continue;
    return scenario;
  }
  // Missed-only mode with keys that cannot be generated under the current
  // rules (e.g. after changing rules): fall back to any hand.
  return generateScenario(rules, { ...opts, mode: "all" }, rng);
}

export interface BSResult {
  readonly correct: boolean;
  readonly chosen: PlayerAction;
  /** EV given up versus the best action, per unit bet (0 when correct). */
  readonly evLoss: number;
  /** Second-best action is within 0.25% of a bet. */
  readonly closeCall: boolean;
}

export const CLOSE_CALL = 0.0025;

export function gradeChoice(s: BSScenario, chosen: PlayerAction): BSResult {
  const { advice } = s;
  const correct = advice.acceptable.includes(chosen);
  const bestEv = advice.evs[advice.best]!;
  const chosenEv = advice.evs[chosen] ?? bestEv;
  const others = Object.entries(advice.evs)
    .filter(([a]) => !advice.acceptable.includes(a as PlayerAction))
    .map(([, v]) => v as number);
  const runnerUp = others.length ? Math.max(...others) : -Infinity;
  return { correct, chosen, evLoss: correct ? 0 : bestEv - chosenEv, closeCall: bestEv - runnerUp < CLOSE_CALL };
}
