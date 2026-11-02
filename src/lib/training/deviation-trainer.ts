/**
 * Deviation Trainer scenarios. Each exercise is a real shoe state: a concrete
 * discard pile (whose Hi-Lo count, with the visible hand, gives the running
 * count), the player's two cards and the dealer's upcard, all drawn without
 * replacement from one shoe. Target true counts are placed on both sides of
 * the index so the threshold itself is practised.
 */
import { pointRank, type Card, type PointRank, type Rank } from "../blackjack/cards";
import { hiLoValue, runningCount, trueCount, type TrueCountRounding } from "../blackjack/counting";
import { handActions, type PlayerHand } from "../blackjack/engine";
import { randomInt, shuffle, type Rng } from "../blackjack/rng";
import type { TableRules } from "../blackjack/rules";
import { buildCards } from "../blackjack/shoe";
import { isTopValue, type DeviationAction, type DeviationCell } from "../blackjack/deviations/definitions";
import {
  basicActionFor,
  entryFor,
  evaluateDeviation,
  integerIndex,
  usableCells,
  type DeviationEvaluation,
  type IndexSet,
} from "../blackjack/deviations/registry";

export type DeviationFilter = "all" | "valuable" | "positive" | "negative" | "missed" | { cellId: string };

export interface DeviationScenario {
  readonly cell: DeviationCell;
  readonly player: readonly Card[];
  readonly dealerUp: Card;
  readonly discards: readonly Card[];
  readonly runningCount: number;
  readonly decksRemaining: number;
  readonly trueCount: number;
  readonly legal: readonly DeviationAction[];
  readonly basic: DeviationAction;
  readonly evaluation: DeviationEvaluation;
}

/** First crossing's integer index for a cell under a convention. */
export function cellIndex(set: IndexSet, cell: DeviationCell, convention: TrueCountRounding): number | null {
  const e = entryFor(set, cell.id);
  const b = e?.bands[0]?.upTo;
  return b === undefined || b === null ? null : integerIndex(b, convention);
}

export function filterCells(set: IndexSet, rules: TableRules, filter: DeviationFilter, convention: TrueCountRounding, missed: readonly string[] = []): DeviationCell[] {
  const cells = usableCells(set, rules);
  if (typeof filter === "object") return cells.filter((c) => c.id === filter.cellId);
  switch (filter) {
    case "all":
      return cells;
    case "valuable":
      return cells.filter(isTopValue);
    case "positive":
      return cells.filter((c) => (cellIndex(set, c, convention) ?? 0) > 0);
    case "negative":
      return cells.filter((c) => (cellIndex(set, c, convention) ?? 0) < 0);
    case "missed":
      return cells.filter((c) => missed.includes(c.id));
  }
}

function pick<T>(xs: readonly T[], rng: Rng): T {
  return xs[randomInt(rng, xs.length)];
}

/** Two-card ranks for a cell: non-pair, ace-free compositions of a hard total, or the pair. */
function handRanks(cell: DeviationCell, rng: Rng): [PointRank, PointRank] | null {
  if (cell.kind === "insurance") {
    const options: [PointRank, PointRank][] = [];
    for (let i = 2; i <= 10; i++) for (let j = 2; j <= 10; j++) options.push([i as PointRank, j as PointRank]);
    return pick(options, rng);
  }
  const h = cell.hand!;
  if (h.kind === "pair") return [h.rank, h.rank];
  const options: [PointRank, PointRank][] = [];
  for (let i = 2; i <= 10; i++) {
    const j = h.total - i;
    if (j > i && j <= 10) options.push([i as PointRank, j as PointRank]);
  }
  return options.length ? pick(options, rng) : null;
}

function takeRank(pool: Card[], r: PointRank, rng: Rng): Card {
  const idx = pool.map((c, i) => [c, i] as const).filter(([c]) => pointRank(c.rank) === r).map(([, i]) => i);
  const i = pick(idx, rng);
  return pool.splice(i, 1)[0];
}

/**
 * Choose `n` discards from `pool` whose Hi-Lo sum is `target`, starting from a
 * random sample and swapping cards with the undealt pool one tag step at a
 * time. Returns null if the target is out of reach.
 */
function discardsWithCount(pool: Card[], n: number, target: number, rng: Rng): { discards: Card[]; rest: Card[] } | null {
  const mixed = shuffle(pool, rng);
  const discards = mixed.slice(0, n);
  const rest = mixed.slice(n);
  let sum = runningCount(discards);
  for (let guard = 0; sum !== target && guard < 10000; guard++) {
    const up = sum < target;
    const di = discards.findIndex((c) => (up ? hiLoValue(c.rank) < 1 : hiLoValue(c.rank) > -1));
    if (di < 0) return null;
    const want = hiLoValue(discards[di].rank) + (up ? 1 : -1);
    const ri = rest.findIndex((c) => hiLoValue(c.rank) === want);
    if (ri < 0) {
      // Try a two-step swap (high↔low) if no neutral card is available.
      const want2 = hiLoValue(discards[di].rank) + (up ? 2 : -2);
      const r2 = Math.abs(want2) <= 1 ? rest.findIndex((c) => hiLoValue(c.rank) === want2) : -1;
      if (r2 < 0) return null;
      [discards[di], rest[r2]] = [rest[r2], discards[di]];
    } else {
      [discards[di], rest[ri]] = [rest[ri], discards[di]];
    }
    sum = runningCount(discards);
  }
  return sum === target ? { discards: shuffle(discards, rng), rest } : null;
}

export function generateDeviationScenario(
  set: IndexSet,
  rules: TableRules,
  convention: TrueCountRounding,
  cells: readonly DeviationCell[],
  rng: Rng,
): DeviationScenario | null {
  if (cells.length === 0) return null;
  const decks = rules.decks;
  for (let attempt = 0; attempt < 200; attempt++) {
    const cell = pick(cells, rng);
    const entry = entryFor(set, cell.id)!;
    const boundaries = entry.bands.filter((b) => b.upTo !== null).map((b) => integerIndex(b.upTo!, convention));
    if (!boundaries.length) continue;
    const target = pick(boundaries, rng) + pick([-2, -1, -1, 0, 0, 1, 1, 2], rng);
    if (Math.abs(target) > 8) continue;

    // Decks remaining: quarter decks between ~15% and ~85% of the shoe left.
    const minQ = Math.max(2, Math.ceil(decks * 4 * 0.15));
    const maxQ = Math.floor(decks * 4 * 0.85);
    const D = (minQ + randomInt(rng, maxQ - minQ + 1)) / 4;

    // Running counts that convert to the target true count at this deck estimate.
    const rcs: number[] = [];
    for (let rc = Math.floor((target - 1.5) * D); rc <= Math.ceil((target + 1.5) * D); rc++) {
      if (trueCount(rc, D, convention) === target) rcs.push(rc);
    }
    if (!rcs.length) continue;
    const rc = pick(rcs, rng);

    const ranks = handRanks(cell, rng);
    if (!ranks) continue;
    const pool = buildCards(decks);
    const up = takeRank(pool, cell.up, rng);
    const player = [takeRank(pool, ranks[0], rng), takeRank(pool, ranks[1], rng)];
    const seenHand = runningCount([up, ...player]);
    const nDiscards = Math.round(52 * (decks - D)) - 3;
    if (nDiscards < 0) continue;
    const built = discardsWithCount(pool, nDiscards, rc - seenHand, rng);
    if (!built) continue;

    const legal: DeviationAction[] =
      cell.kind === "insurance"
        ? ["insure", "decline"]
        : handActions(rules, { cards: player, bet: 1, fromSplit: false, isSplitAces: false, doubled: false, surrendered: false, done: false } satisfies PlayerHand, 1);
    const basic: DeviationAction =
      cell.kind === "insurance"
        ? "decline"
        : basicActionFor(rules, player.map((c) => c.rank) as Rank[], up.rank, legal.filter((a): a is Exclude<DeviationAction, "insure" | "decline"> => a !== "insure" && a !== "decline"));
    const evaluation = evaluateDeviation(set, convention, { cell, runningCount: rc, decksEstimate: D, deckTolerance: 0, legal, basic });
    return { cell, player, dealerUp: up, discards: built.discards, runningCount: rc, decksRemaining: D, trueCount: evaluation.trueCount, legal, basic, evaluation };
  }
  return null;
}

export function gradeDeviationAnswer(s: DeviationScenario, chosen: DeviationAction): { correct: boolean; matchedBasic: boolean } {
  return { correct: s.evaluation.acceptable.includes(chosen), matchedBasic: chosen === s.basic };
}
