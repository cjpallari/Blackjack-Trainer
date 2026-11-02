/**
 * Grading of the human's decisions at the table. Pure, and separate from
 * game execution: grading reads the state *before* the action is applied
 * and never changes which actions are allowed.
 */
import { pointRank, type PointRank, type Rank } from "../../blackjack/cards";
import { CELL_BY_ID } from "../../blackjack/deviations/definitions";
import { availableActions, type GameState } from "../../blackjack/engine";
import type { TableRules } from "../../blackjack/rules";
import { evaluateDecision, strategyTableFor, type HandCategory, type PlayerAction, type StrategyAdvice } from "../../blackjack/strategy";
import { buildTableView, type TableView } from "../../blackjack/table-view";
import type { TrueCountRounding } from "../../blackjack/counting";
import type { DeviationAction } from "../../blackjack/deviations/definitions";
import {
  cellUnavailableReason,
  evaluateDeviation,
  matchCell,
  type DeviationEvaluation,
  type IndexSetResolution,
} from "../../blackjack/deviations/registry";
import { deckTolerance } from "../true-count";
import { quarterDeckEstimate } from "./count-checks";
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
  /** Count-based evaluation when this decision is an index play under an active index set. */
  readonly deviation: DeviationGrade | null;
  /**
   * Correct under the strategy actually being graded: count-adjusted when a
   * deviation applies, otherwise basic strategy. null when ungraded.
   */
  readonly countCorrect: boolean | null;
}

/**
 * - followed: the count called for a deviation and the player made it
 * - missed: the count called for a deviation and the player played basic strategy
 * - wrong-deviation: no deviation was due, but the player made the index play anyway
 * - held: no deviation was due and the player played basic strategy
 * - other: a play that is neither basic nor the count-adjusted play
 */
export type DeviationOutcome = "followed" | "missed" | "wrong-deviation" | "held" | "other";

export interface DeviationGrade extends DeviationEvaluation {
  readonly outcome: DeviationOutcome;
  readonly chosen: DeviationAction;
}

export interface DeviationContext {
  readonly resolution: IndexSetResolution;
  readonly convention: TrueCountRounding;
}

export function classifyDeviation(e: DeviationEvaluation, chosen: DeviationAction): DeviationOutcome {
  const deviationPlays = new Set(e.acceptable.filter((a) => a !== e.basic));
  if (e.deviates || (e.borderline && deviationPlays.size)) {
    if (e.acceptable.includes(chosen)) return chosen === e.basic ? "held" : "followed";
    return chosen === e.basic ? "missed" : "other";
  }
  if (chosen === e.basic) return "held";
  return e.indexPlays.includes(chosen) ? "wrong-deviation" : "other";
}

/**
 * Count-based evaluation using only what the player can see: the running
 * count of exposed cards and a quarter-deck estimate of the undealt cards.
 * Answers consistent with any deck estimate within the tolerance are accepted.
 */
export function deviationForState(
  state: GameState,
  ctx: DeviationContext | undefined,
  hand: { cards: readonly Rank[]; up: Rank; fromSplit: boolean },
  legal: readonly DeviationAction[],
  basic: DeviationAction,
  insurance = false,
): DeviationEvaluation | null {
  return deviationFromView(buildTableView(state), state.rules, ctx, hand, legal, basic, insurance);
}

/** Same evaluation from a table view (used for hints, so hints and grades always agree). */
export function deviationFromView(
  view: TableView,
  rules: TableRules,
  ctx: DeviationContext | undefined,
  hand: { cards: readonly Rank[]; up: Rank; fromSplit: boolean },
  legal: readonly DeviationAction[],
  basic: DeviationAction,
  insurance = false,
): DeviationEvaluation | null {
  if (!ctx || !ctx.resolution.supported) return null;
  const { set } = ctx.resolution;
  if (!view.count.valid) return null;
  const cell = insurance ? CELL_INSURANCE : matchCell(hand);
  if (!cell || cellUnavailableReason(set, cell, rules, ctx.convention)) return null;
  return evaluateDeviation(set, ctx.convention, {
    cell,
    runningCount: view.count.runningCount,
    decksEstimate: quarterDeckEstimate(view.shoe.cardsInShoe),
    deckTolerance: deckTolerance(rules.decks),
    legal,
    basic,
  });
}

export interface TableHint {
  readonly basic: StrategyAdvice | null;
  /** Count-adjusted evaluation when this is an index play. */
  readonly deviation: DeviationEvaluation | null;
  readonly insurance: boolean;
}

/** Recommendation for the human's current decision (play or insurance), from the view only. */
export function hintFromView(view: TableView, rules: TableRules, ctx: DeviationContext | undefined): TableHint | null {
  const up = view.dealer.cards[0];
  if (!up || up.faceDown) return null;
  if (view.insuranceOffer) {
    const human = view.seats.find((s) => s.kind === "human");
    const cards = human?.hands[0]?.cards.flatMap((c) => (c.faceDown ? [] : [c.rank])) ?? [];
    return { basic: null, insurance: true, deviation: deviationFromView(view, rules, ctx, { cards, up: up.rank, fromSplit: false }, ["insure", "decline"], "decline", true) };
  }
  const basic = adviceFromView(view, rules);
  if (!basic || !view.turn) return null;
  const hand = view.seats[view.turn.seat].hands[view.turn.hand];
  const cards = hand.cards.flatMap((c) => (c.faceDown ? [] : [c.rank]));
  return { basic, insurance: false, deviation: deviationFromView(view, rules, ctx, { cards, up: up.rank, fromSplit: hand.fromSplit }, view.available, basic.best) };
}

const CELL_INSURANCE = CELL_BY_ID.get("insurance")!;

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
export function gradeTableDecision(state: GameState, chosen: PlayerAction, ctx?: DeviationContext): DecisionRecord {
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
      deviation: null,
      countCorrect: null,
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
  const dev = deviationForState(state, ctx, { cards: base.cards, up: base.upcard, fromSplit: hand.fromSplit }, available, advice.best);
  const deviation: DeviationGrade | null = dev ? { ...dev, chosen, outcome: classifyDeviation(dev, chosen) } : null;
  const countCorrect = deviation ? deviation.acceptable.includes(chosen) : correct;
  if (deviation) notes.push("Index play: graded against the count-adjusted strategy; EV at this count is not estimated.");
  return {
    ...base,
    best: advice.best,
    acceptable: advice.acceptable,
    correct,
    // Off-the-top EV loss only describes basic-strategy mistakes away from index plays.
    evLoss: deviation ? null : correct || chosenEv === undefined ? 0 : bestEv - chosenEv,
    quality,
    notes,
    category: advice.category,
    key: scenarioKey(advice.row, up),
    deviation,
    countCorrect,
  };
}

export interface InsuranceRecord {
  readonly round: number;
  readonly max: number;
  readonly amount: number;
  readonly chosen: "insure" | "decline";
  /** Basic strategy never takes insurance. */
  readonly basic: "decline";
  readonly deviation: DeviationGrade | null;
  /** Count-adjusted when an insurance index is active, otherwise vs basic (decline). */
  readonly countCorrect: boolean;
}

export function gradeInsurance(state: GameState, amount: number, max: number, ctx?: DeviationContext): InsuranceRecord {
  const chosen = amount > 0 ? "insure" : "decline";
  const human = state.seats.find((s) => s.kind === "human")!;
  const dev = deviationForState(state, ctx, { cards: human.hands[0].cards.map((c) => c.rank), up: state.dealer.cards[0].rank, fromSplit: false }, ["insure", "decline"], "decline", true);
  const deviation: DeviationGrade | null = dev ? { ...dev, chosen, outcome: classifyDeviation(dev, chosen) } : null;
  return {
    round: state.roundNumber,
    max,
    amount,
    chosen,
    basic: "decline",
    deviation,
    countCorrect: deviation ? deviation.acceptable.includes(chosen) : chosen === "decline",
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
