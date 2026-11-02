/**
 * Grading of the human's decisions at the table. Pure, and separate from
 * game execution: grading reads the state *before* the action is applied
 * and never changes which actions are allowed.
 */
import { pointRank, type PointRank, type Rank } from "../../blackjack/cards";
import { availableActions, type GameState } from "../../blackjack/engine";
import type { TableRules } from "../../blackjack/rules";
import { evaluateDecision, strategyTableFor, type HandCategory, type PlayerAction, type StrategyAdvice } from "../../blackjack/strategy";
import type { TableView } from "../../blackjack/table-view";
import { scenarioKey } from "../basic-strategy";

/**
 * - "table": a two-card starting hand graded from the strategy table. EVs are
 *   the table's probability-weighted average for that total, not the exact
 *   card composition, so EV loss is still an estimate.
 * - "approximate": the table is used outside its exact model (multi-card
 *   hands, hands after a split, split decisions without resplit modelling).
 * - "ungraded": the tables don't model the situation at all; no grade given.
 */
export type GradeQuality = "table" | "approximate" | "ungraded";

export interface DecisionRecord {
  readonly round: number;
  readonly handIndex: number;
  readonly cards: readonly Rank[];
  readonly upcard: Rank;
  readonly rules: string;
  readonly available: readonly PlayerAction[];
  readonly chosen: PlayerAction;
  readonly best: PlayerAction | null;
  readonly acceptable: readonly PlayerAction[];
  /** null when ungraded. */
  readonly correct: boolean | null;
  /** Estimated EV given up versus the best legal action, per unit of the hand's bet. null when ungraded. */
  readonly evLoss: number | null;
  readonly quality: GradeQuality;
  readonly notes: readonly string[];
  readonly category: HandCategory | null;
  /** Scenario key shared with the Basic Strategy trainer, e.g. "hard 16|10". */
  readonly key: string | null;
}

export function rulesLabel(r: TableRules): string {
  return [
    `${r.decks}D`,
    r.dealerHitsSoft17 ? "H17" : "S17",
    r.doubleAfterSplit ? "DAS" : "NDAS",
    r.doubleRestriction === "any2" ? "DA2" : `D${r.doubleRestriction}`,
    r.surrender === "late" ? "LS" : "NS",
    `SP${r.maxSplitHands}`,
    r.resplitAces ? "RSA" : "",
    r.hitSplitAces ? "HSA" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Grade the decision the human is about to make. Must be called before the action is executed. */
export function gradeTableDecision(state: GameState, chosen: PlayerAction): DecisionRecord {
  const turn = state.turn;
  if (!turn) throw new Error("No decision pending.");
  const seat = state.seats[turn.seat];
  const hand = seat.hands[turn.hand];
  const rules = state.rules;
  const available = availableActions(state);
  const base = {
    round: state.roundNumber,
    handIndex: turn.hand,
    cards: hand.cards.map((c) => c.rank),
    upcard: state.dealer.cards[0].rank,
    rules: rulesLabel(rules),
    available,
    chosen,
  };

  if (hand.isSplitAces && rules.hitSplitAces) {
    return {
      ...base,
      best: null,
      acceptable: [],
      correct: null,
      evLoss: null,
      quality: "ungraded",
      notes: ["Split aces that may be hit are not modelled by the strategy tables (they assume one card per split ace)."],
      category: null,
      key: null,
    };
  }

  const ranks = hand.cards.map((c) => pointRank(c.rank)) as PointRank[];
  const up = pointRank(state.dealer.cards[0].rank);
  const advice = evaluateDecision(strategyTableFor(rules), rules, { cards: ranks, up, available });

  const notes: string[] = [];
  if (hand.cards.length > 2) notes.push("Multi-card hand: graded with the two-card values for this total.");
  if (hand.fromSplit) notes.push("Hand after a split: graded with unsplit-hand values.");
  if (advice.category === "pair" && available.includes("split"))
    notes.push(
      rules.maxSplitHands > 2
        ? "Split EV is computed without resplitting, so it understates the value of splitting here."
        : "Split EV is computed without resplitting.",
    );
  const quality: GradeQuality = notes.length ? "approximate" : "table";
  if (!notes.length) notes.push("Two-card hand: EV is the table average for this total, not this exact composition.");

  const correct = advice.acceptable.includes(chosen);
  const bestEv = advice.evs[advice.best]!;
  const chosenEv = advice.evs[chosen];
  return {
    ...base,
    best: advice.best,
    acceptable: advice.acceptable,
    correct,
    evLoss: correct || chosenEv === undefined ? 0 : bestEv - chosenEv,
    quality,
    notes,
    category: advice.category,
    key: scenarioKey(advice.row, up),
  };
}

/**
 * Recommendation for the human's current hand, computed from the table view
 * only (visible cards and legal actions), for modes that show hints.
 */
export function adviceFromView(view: TableView, rules: TableRules): StrategyAdvice | null {
  if (!view.turn || view.available.length === 0) return null;
  const hand = view.seats[view.turn.seat]?.hands[view.turn.hand];
  const up = view.dealer.cards[0];
  if (!hand || !up || up.faceDown) return null;
  const ranks: PointRank[] = [];
  for (const c of hand.cards) {
    if (c.faceDown) return null;
    ranks.push(pointRank(c.rank));
  }
  if (hand.fromSplit && ranks[0] === 1 && rules.hitSplitAces) return null;
  return evaluateDecision(strategyTableFor(rules), rules, { cards: ranks, up: pointRank(up.rank), available: view.available });
}
