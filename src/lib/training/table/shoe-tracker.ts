/**
 * Per-shoe history: count snapshots at round boundaries, checkpoints, and
 * graded decisions, plus the end-of-shoe report built from them.
 */
import type { TableRules } from "../../blackjack/rules";
import type { PlayerAction } from "../../blackjack/strategy";
import { describeRules } from "../../blackjack/rules";
import type { CheckpointActual, CheckpointAnswer, CheckpointGrade, CheckpointTrigger } from "./count-checks";
import type { DecisionRecord, InsuranceRecord } from "./decisions";
import type { BetRecord } from "./betting";
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
  readonly insurance: readonly (InsuranceRecord & { readonly net: number })[];
  /** Wagers graded against the betting ramp (betting training only). */
  readonly bets: readonly BetRecord[];
  /** False once the engine flags the count invalid (mid-round exhaustion). */
  readonly countValid: boolean;
  /** Index set used for deviation grading, or why there is none. */
  readonly deviationSet: DeviationSetInfo;
}

export type DeviationSetInfo = { readonly id: string } | { readonly unavailable: string };

export function createTracker(shoeNumber: number, rules: TableRules, mode: TrainingMode, at: number, deviationSet: DeviationSetInfo = { unavailable: "Deviation grading is off." }): ShoeTracker {
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
    insurance: [],
    bets: [],
    countValid: true,
    deviationSet,
  };
}

export function recordBet(t: ShoeTracker, b: BetRecord): ShoeTracker {
  return { ...t, bets: [...t.bets, b] };
}

export function recordInsurance(t: ShoeTracker, r: InsuranceRecord & { net: number }): ShoeTracker {
  return { ...t, insurance: [...t.insurance, r] };
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

export interface CellDeviationStats {
  readonly cellId: string;
  readonly label: string;
  readonly decisions: number;
  readonly correct: number;
  readonly opportunities: number;
  readonly followed: number;
  readonly missed: number;
  readonly wrong: number;
}

export interface DeviationReport {
  readonly indexSetId: string;
  /** Decisions where the count called for a deviation. */
  readonly opportunities: number;
  readonly followed: number;
  readonly missed: number;
  /** Index plays made when the count did not call for them. */
  readonly wrongDeviations: number;
  /** Decisions where the deck-estimate tolerance straddled the index (both plays accepted). */
  readonly borderline: number;
  readonly byCell: readonly CellDeviationStats[];
}

export interface ShoeReport {
  readonly version: 2;
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
    /** Sum of estimated EV lost from basic-strategy mistakes (index plays excluded), in units of the hands' bets. */
    readonly estimatedEvLost: number;
    readonly topMisses: readonly MissSummary[];
    /** "count-adjusted" when deviations were graded: a correct index play is not a mistake. */
    readonly grading: "basic" | "count-adjusted";
    /** Decisions that matched basic strategy exactly. */
    readonly basicMatches: number;
  };
  /** Count-based play results; null when no index set was active (see deviationsNote). */
  readonly deviations: DeviationReport | null;
  readonly deviationsNote: string | null;
  /** Betting-ramp accuracy, separate from playing strategy and counting (absent before Phase 8). */
  readonly betting?: {
    readonly rampName: string;
    readonly decisions: number;
    readonly correct: number;
    readonly misses: readonly { readonly round: number; readonly trueCount: number; readonly recommended: number; readonly chosen: number }[];
  } | null;
  readonly insurance: {
    readonly offered: number;
    readonly taken: number;
    readonly staked: number;
    readonly net: number;
    readonly correct: number;
  } | null;
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
  const deviationsOn = "id" in t.deviationSet;
  const isCorrect = (d: DecisionRecord) => (d.countCorrect ?? d.correct) === true;
  const wrong = graded.filter((d) => !isCorrect(d));
  const misses = new Map<string, MissSummary>();
  for (const d of wrong) {
    const k = d.key!;
    const prev = misses.get(k);
    const best = (d.deviation?.countAction ?? d.best!) as PlayerAction;
    misses.set(k, { key: k, count: (prev?.count ?? 0) + 1, chosen: d.chosen, best });
  }

  const last = t.snapshots[t.snapshots.length - 1];
  const tcs = t.snapshots.slice(1).map((s) => s.trueCount);
  const valid = t.countValid && end.termination !== "exhausted";

  return {
    version: 2,
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
      grading: deviationsOn ? "count-adjusted" : "basic",
      basicMatches: graded.filter((d) => d.correct === true).length,
    },
    deviations: deviationsOn ? deviationReport(t, (t.deviationSet as { id: string }).id) : null,
    deviationsNote: "unavailable" in t.deviationSet ? t.deviationSet.unavailable : null,
    betting: t.bets.length
      ? {
          rampName: t.bets[0].rampName,
          decisions: t.bets.length,
          correct: t.bets.filter((b) => b.correct).length,
          misses: t.bets
            .filter((b) => !b.correct)
            .slice(0, 20)
            .map((b) => ({ round: b.round, trueCount: b.trueCount, recommended: b.recommended, chosen: b.chosen })),
        }
      : null,
    insurance: t.insurance.length
      ? {
          offered: t.insurance.length,
          taken: t.insurance.filter((i) => i.amount > 0).length,
          staked: t.insurance.reduce((n, i) => n + i.amount, 0),
          net: t.insurance.reduce((n, i) => n + i.net, 0),
          correct: t.insurance.filter((i) => i.countCorrect).length,
        }
      : null,
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

function deviationReport(t: ShoeTracker, indexSetId: string): DeviationReport {
  const grades = [
    ...t.decisions.flatMap((d) => (d.deviation ? [d.deviation] : [])),
    ...t.insurance.flatMap((i) => (i.deviation ? [i.deviation] : [])),
  ];
  const byCell = new Map<string, { -readonly [K in keyof CellDeviationStats]: CellDeviationStats[K] }>();
  for (const g of grades) {
    const c = byCell.get(g.cellId) ?? { cellId: g.cellId, label: g.label, decisions: 0, correct: 0, opportunities: 0, followed: 0, missed: 0, wrong: 0 };
    c.decisions++;
    if (g.acceptable.includes(g.chosen)) c.correct++;
    if (g.deviates) c.opportunities++;
    if (g.outcome === "followed") c.followed++;
    if (g.outcome === "missed") c.missed++;
    if (g.outcome === "wrong-deviation") c.wrong++;
    byCell.set(g.cellId, c);
  }
  return {
    indexSetId,
    opportunities: grades.filter((g) => g.deviates).length,
    followed: grades.filter((g) => g.outcome === "followed").length,
    missed: grades.filter((g) => g.outcome === "missed").length,
    wrongDeviations: grades.filter((g) => g.outcome === "wrong-deviation").length,
    borderline: grades.filter((g) => g.borderline).length,
    byCell: [...byCell.values()].sort((a, b) => b.missed + b.wrong - (a.missed + a.wrong) || b.decisions - a.decisions),
  };
}

/** Upgrade a saved version-1 report (before deviations and insurance) to version 2. */
export function migrateReport(r: unknown): ShoeReport | null {
  if (!r || typeof r !== "object") return null;
  const x = r as { version?: number; strategy?: Record<string, unknown> };
  if (x.version === 2) return r as ShoeReport;
  if (x.version !== 1 || !x.strategy) return null;
  const v1 = r as Omit<ShoeReport, "version" | "deviations" | "deviationsNote" | "insurance" | "strategy"> & { strategy: Omit<ShoeReport["strategy"], "grading" | "basicMatches"> };
  return {
    ...v1,
    version: 2,
    strategy: { ...v1.strategy, grading: "basic", basicMatches: v1.strategy.correct },
    deviations: null,
    deviationsNote: "Recorded before deviation grading existed.",
    insurance: null,
  };
}
