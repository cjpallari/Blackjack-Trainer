/**
 * Per-shoe history: count snapshots at round boundaries, checkpoints, and
 * graded decisions, plus the end-of-shoe report built from them.
 */
import type { TableRules } from "../../blackjack/rules";
import type { PlayerAction } from "../../blackjack/strategy";
import { describeRules } from "../../blackjack/rules";
import type { CheckpointActual, CheckpointAnswer, CheckpointGrade, CheckpointTrigger } from "./count-checks";
import type { DecisionRecord } from "./decisions";
import type { TrainingMode } from "./modes";

/** Count state after a completed round, when every card dealt so far has been seen. */
export interface CountSnapshot {
  readonly round: number;
  readonly cardsDealt: number;
  readonly cardsRemaining: number;
  readonly runningCount: number;
  /** Unrounded RC ÷ (undealt cards / 52). */
  readonly trueCount: number;
}

export interface CheckpointRecord {
  readonly round: number;
  readonly trigger: CheckpointTrigger;
  /** True if taken between rounds; false if taken during the player's turn. */
  readonly atBoundary: boolean;
  readonly actual: CheckpointActual;
  readonly answer: CheckpointAnswer;
  readonly grade: CheckpointGrade;
}

export type ShoeTermination = "cut-card" | "insufficient-cards" | "exhausted" | "abandoned";

export const TERMINATION_LABEL: Record<ShoeTermination, string> = {
  "cut-card": "Cut card reached",
  "insufficient-cards": "Too few cards for another round",
  exhausted: "Shoe ran out mid-round (emergency reshuffle)",
  abandoned: "Ended early (table changed)",
};

export interface ShoeTracker {
  readonly shoeNumber: number;
  readonly startedAt: number;
  readonly rules: TableRules;
  readonly modes: readonly TrainingMode[];
  readonly totalCards: number;
  readonly rounds: number;
  readonly snapshots: readonly CountSnapshot[];
  readonly checkpoints: readonly CheckpointRecord[];
  readonly decisions: readonly DecisionRecord[];
  /** False once the engine flags the count invalid (mid-round exhaustion). */
  readonly countValid: boolean;
}

export function createTracker(shoeNumber: number, rules: TableRules, mode: TrainingMode, at: number): ShoeTracker {
  const totalCards = rules.decks * 52;
  return {
    shoeNumber,
    startedAt: at,
    rules,
    modes: [mode],
    totalCards,
    rounds: 0,
    snapshots: [{ round: 0, cardsDealt: 0, cardsRemaining: totalCards, runningCount: 0, trueCount: 0 }],
    checkpoints: [],
    decisions: [],
    countValid: true,
  };
}

export function noteMode(t: ShoeTracker, mode: TrainingMode): ShoeTracker {
  return t.modes.includes(mode) ? t : { ...t, modes: [...t.modes, mode] };
}

export function recordRound(t: ShoeTracker, s: { round: number; cardsRemaining: number; runningCount: number; valid: boolean }): ShoeTracker {
  const cardsDealt = t.totalCards - s.cardsRemaining;
  const snap: CountSnapshot = {
    round: s.round,
    cardsDealt,
    cardsRemaining: s.cardsRemaining,
    runningCount: s.runningCount,
    trueCount: s.cardsRemaining > 0 ? s.runningCount / (s.cardsRemaining / 52) : 0,
  };
  return { ...t, rounds: t.rounds + 1, snapshots: [...t.snapshots, snap], countValid: t.countValid && s.valid };
}

export function recordDecision(t: ShoeTracker, d: DecisionRecord): ShoeTracker {
  return { ...t, decisions: [...t.decisions, d] };
}

export function recordCheckpoint(t: ShoeTracker, c: CheckpointRecord): ShoeTracker {
  return { ...t, checkpoints: [...t.checkpoints, c], countValid: t.countValid && c.actual.valid };
}

// ---------------------------------------------------------------------------

export interface MissSummary {
  readonly key: string;
  readonly count: number;
  readonly chosen: PlayerAction;
  readonly best: PlayerAction;
}

export interface ShoeReport {
  readonly version: 1;
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly rulesSummary: string;
  readonly decks: number;
  readonly dealerHitsSoft17: boolean;
  readonly modes: readonly TrainingMode[];
  readonly termination: ShoeTermination;
  readonly completedNormally: boolean;
  readonly counting: {
    /** False for interrupted shoes: excluded from validated counting metrics. */
    readonly valid: boolean;
    readonly invalidReason: string | null;
    readonly checkpoints: number;
    readonly answered: number;
    readonly correct: number;
    /** Mean |answer − actual| over answered checkpoints. */
    readonly avgAbsRcError: number | null;
    readonly tcAnswered: number;
    readonly tcCorrect: number;
    readonly avgAbsTcError: number | null;
    readonly deckEstimates: number;
    readonly deckCorrect: number;
    readonly arithmeticChecked: number;
    readonly arithmeticCorrect: number;
    readonly finalSubmitted: number | null;
    readonly finalActual: number;
  };
  readonly strategy: {
    readonly decisions: number;
    readonly graded: number;
    readonly correct: number;
    readonly incorrect: number;
    readonly ungraded: number;
    /** Graded decisions that relied on an approximation (multi-card, post-split, split EV). */
    readonly approximate: number;
    readonly accuracy: number | null;
    /** Sum of estimated EV lost, in units of the affected hands' bets. */
    readonly estimatedEvLost: number;
    readonly topMisses: readonly MissSummary[];
  };
  readonly shoe: {
    readonly rounds: number;
    readonly cardsDealt: number;
    readonly totalCards: number;
    readonly finalPenetration: number;
    readonly maxTrueCount: number | null;
    readonly minTrueCount: number | null;
  };
  /** Actual true count after each round (unrounded). */
  readonly progression: readonly { round: number; cardsDealt: number; runningCount: number; trueCount: number }[];
  /** Player estimates at checkpoints, against the actual values at that moment. */
  readonly estimates: readonly {
    round: number;
    cardsDealt: number;
    trigger: CheckpointTrigger;
    actualRc: number;
    estimatedRc: number | null;
    actualTc: number | null;
    estimatedTc: number | null;
  }[];
  /** Full decision log, only kept when detailed history is enabled. */
  readonly decisions?: readonly DecisionRecord[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function buildShoeReport(
  t: ShoeTracker,
  end: { termination: ShoeTermination; at: number; finalActual: number; keepDecisions: boolean },
): ShoeReport {
  const cps = t.checkpoints;
  const answered = cps.filter((c) => c.grade.answered);
  const tcAnswered = cps.filter((c) => c.grade.tcError !== null);
  const decks = cps.filter((c) => c.grade.decksAsked);
  const arith = cps.filter((c) => c.grade.arithmeticCorrect !== null);
  const final = [...cps].reverse().find((c) => c.trigger === "end-of-shoe");

  const graded = t.decisions.filter((d) => d.correct !== null);
  const wrong = graded.filter((d) => d.correct === false);
  const misses = new Map<string, MissSummary>();
  for (const d of wrong) {
    const k = d.key!;
    const prev = misses.get(k);
    misses.set(k, { key: k, count: (prev?.count ?? 0) + 1, chosen: d.chosen, best: d.best! });
  }

  const last = t.snapshots[t.snapshots.length - 1];
  const tcs = t.snapshots.slice(1).map((s) => s.trueCount);
  const valid = t.countValid && end.termination !== "exhausted";

  return {
    version: 1,
    id: `${t.startedAt.toString(36)}-${t.shoeNumber}`,
    startedAt: t.startedAt,
    endedAt: end.at,
    rulesSummary: describeRules(t.rules),
    decks: t.rules.decks,
    dealerHitsSoft17: t.rules.dealerHitsSoft17,
    modes: t.modes,
    termination: end.termination,
    completedNormally: end.termination === "cut-card" || end.termination === "insufficient-cards",
    counting: {
      valid,
      invalidReason: valid
        ? null
        : "The shoe ran out mid-round and the discards were reshuffled to finish it, so the count no longer describes a real shoe. This shoe is excluded from validated counting accuracy.",
      checkpoints: cps.length,
      answered: answered.length,
      correct: answered.filter((c) => c.grade.rcCorrect).length,
      avgAbsRcError: mean(answered.map((c) => Math.abs(c.grade.rcError!))),
      tcAnswered: tcAnswered.length,
      tcCorrect: tcAnswered.filter((c) => c.grade.tcCorrect).length,
      avgAbsTcError: mean(tcAnswered.map((c) => Math.abs(c.grade.tcError!))),
      deckEstimates: decks.length,
      deckCorrect: decks.filter((c) => c.grade.deckCorrect).length,
      arithmeticChecked: arith.length,
      arithmeticCorrect: arith.filter((c) => c.grade.arithmeticCorrect).length,
      finalSubmitted: final?.grade.answered ? final.answer.runningCount : null,
      finalActual: end.finalActual,
    },
    strategy: {
      decisions: t.decisions.length,
      graded: graded.length,
      correct: graded.length - wrong.length,
      incorrect: wrong.length,
      ungraded: t.decisions.length - graded.length,
      approximate: graded.filter((d) => d.quality === "approximate").length,
      accuracy: graded.length ? (graded.length - wrong.length) / graded.length : null,
      estimatedEvLost: graded.reduce((n, d) => n + (d.evLoss ?? 0), 0),
      topMisses: [...misses.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    },
    shoe: {
      rounds: t.rounds,
      cardsDealt: last.cardsDealt,
      totalCards: t.totalCards,
      finalPenetration: last.cardsDealt / t.totalCards,
      maxTrueCount: tcs.length ? Math.max(...tcs) : null,
      minTrueCount: tcs.length ? Math.min(...tcs) : null,
    },
    progression: t.snapshots.map((s) => ({ round: s.round, cardsDealt: s.cardsDealt, runningCount: s.runningCount, trueCount: s.trueCount })),
    estimates: cps.map((c) => ({
      round: c.round,
      cardsDealt: c.actual.cardsDealt,
      trigger: c.trigger,
      actualRc: c.actual.runningCount,
      estimatedRc: c.grade.answered ? c.answer.runningCount : null,
      actualTc: c.actual.trueCountRaw,
      estimatedTc: c.grade.tcAsked && c.answer.trueCount !== undefined ? (c.answer.trueCount ?? null) : null,
    })),
    ...(end.keepDecisions ? { decisions: t.decisions } : {}),
  };
}
