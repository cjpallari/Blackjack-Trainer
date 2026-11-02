/**
 * Counting/strategy training layered on a table session. Pure: each function
 * returns a new TrainingTable. Game execution stays in the engine and table
 * session; this module only observes it (grading decisions before they are
 * executed, snapshotting counts at round boundaries) and schedules
 * checkpoints at stable points.
 */
import type { TrueCountRounding } from "../../blackjack/counting";
import { cardsRemaining } from "../../blackjack/shoe";
import { IllegalActionError, minimumCardsForRound, type GameState } from "../../blackjack/engine";
import type { Rng } from "../../blackjack/rng";
import type { PlayerAction } from "../../blackjack/strategy";
import { buildTableView } from "../../blackjack/table-view";
import { createTableSession, dealRound, playerAction, type TableConfig, type TableSession } from "../../blackjack/table-session";
import { actualFromView, gradeCheckpoint, shouldCheckpoint, type CheckpointAnswer, type CheckpointConfig } from "./count-checks";
import { gradeTableDecision, type DecisionRecord } from "./decisions";
import { assistanceFor, type IntermediateOptions, type TrainingMode } from "./modes";
import {
  buildShoeReport,
  createTracker,
  noteMode,
  recordCheckpoint,
  recordDecision,
  recordRound,
  type CheckpointRecord,
  type ShoeReport,
  type ShoeTermination,
  type ShoeTracker,
} from "./shoe-tracker";

export interface TrainingOptions {
  readonly mode: TrainingMode;
  readonly intermediate: IntermediateOptions;
  readonly checkpoints: CheckpointConfig;
  readonly rounding: TrueCountRounding;
  /** Keep the per-decision log in saved shoe reports (larger storage). */
  readonly keepDecisionDetail: boolean;
}

export type PendingCheck =
  | { readonly kind: "checkpoint"; readonly trigger: "random" | "scheduled" | "manual"; readonly atBoundary: boolean }
  | { readonly kind: "end-of-shoe"; readonly termination: ShoeTermination };

export interface TrainingTable {
  readonly session: TableSession;
  readonly tracker: ShoeTracker;
  readonly roundsSinceCheck: number;
  /** A count check waiting for the player. Dealing and actions are blocked while set. */
  readonly pending: PendingCheck | null;
  readonly lastDecision: DecisionRecord | null;
  readonly lastCheckpoint: CheckpointRecord | null;
  /** Report for the shoe that just ended; cleared when the next round is dealt. */
  readonly completedReport: ShoeReport | null;
  readonly lastRecordedRound: number;
}

export function createTrainingTable(config: TableConfig, opts: TrainingOptions, rng: Rng, at: number): TrainingTable {
  const session = createTableSession(config, rng);
  return {
    session,
    tracker: createTracker(session.state.shoeNumber, config.rules, opts.mode, at),
    roundsSinceCheck: 0,
    pending: null,
    lastDecision: null,
    lastCheckpoint: null,
    completedReport: null,
    lastRecordedRound: 0,
  };
}

/** Why the shoe ends after the round just completed, or null if play continues. */
export function shoeEndReason(state: GameState): ShoeTermination | null {
  if (state.phase !== "roundOver") return null;
  if (!state.count.valid) return "exhausted";
  if (state.reshufflePending) return "cut-card";
  if (cardsRemaining(state.shoe) < minimumCardsForRound(state.seats.length)) return "insufficient-cards";
  return null;
}

export function trainingDeal(t: TrainingTable, bet: number, opts: TrainingOptions, rng: Rng, at: number): TrainingTable {
  if (t.pending) throw new IllegalActionError("Finish the count check first.");
  const session = dealRound(t.session, bet, rng);
  let tracker = t.tracker;
  if (session.state.shoeNumber !== tracker.shoeNumber) tracker = createTracker(session.state.shoeNumber, session.config.rules, opts.mode, at);
  tracker = noteMode(tracker, opts.mode);
  return afterTransition({ ...t, session, tracker, completedReport: null, lastDecision: null, lastCheckpoint: null }, opts, rng, at);
}

export function trainingAct(t: TrainingTable, action: PlayerAction, opts: TrainingOptions, rng: Rng, at: number): TrainingTable {
  if (t.pending) throw new IllegalActionError("Finish the count check first.");
  // Grade first, from the state the player decided on; then execute unchanged.
  const record = gradeTableDecision(t.session.state, action);
  const session = playerAction(t.session, action, rng);
  const tracker = recordDecision(noteMode(t.tracker, opts.mode), record);
  return afterTransition({ ...t, session, tracker, lastDecision: record }, opts, rng, at);
}

function afterTransition(t: TrainingTable, opts: TrainingOptions, rng: Rng, at: number): TrainingTable {
  const state = t.session.state;
  if (state.phase !== "roundOver" || state.roundNumber === t.lastRecordedRound) return t;
  // Round over: every card dealt this round is face up, so the full view is what the player has seen.
  const view = buildTableView(state);
  const tracker = recordRound(t.tracker, {
    round: state.roundNumber,
    cardsRemaining: view.shoe.cardsInShoe,
    runningCount: view.count.runningCount,
    valid: view.count.valid,
  });
  const next = { ...t, tracker, lastRecordedRound: state.roundNumber };
  const end = shoeEndReason(state);
  if (end) {
    // An interrupted shoe has no meaningful final count to ask for.
    const ask = end !== "exhausted" && (opts.checkpoints.endOfShoe || opts.mode === "casino");
    return ask ? { ...next, pending: { kind: "end-of-shoe", termination: end } } : finalizeShoe(next, end, opts, at);
  }
  const since = t.roundsSinceCheck + 1;
  if (shouldCheckpoint(opts.checkpoints, since, rng)) {
    return { ...next, roundsSinceCheck: since, pending: { kind: "checkpoint", trigger: opts.checkpoints.random ? "random" : "scheduled", atBoundary: true } };
  }
  return { ...next, roundsSinceCheck: since };
}

/** Whether the player may ask for a count check right now. */
export function canRequestCheck(t: TrainingTable, opts: TrainingOptions): boolean {
  if (t.pending || !assistanceFor(opts.mode, opts.intermediate).manualChecks) return false;
  const s = t.session.state;
  if (s.phase !== "playerTurn") return true;
  return s.turn !== null && s.seats[s.turn.seat].kind === "human";
}

export function requestCheck(t: TrainingTable, opts: TrainingOptions): TrainingTable {
  if (!canRequestCheck(t, opts)) throw new IllegalActionError("A count check isn't available now.");
  return { ...t, pending: { kind: "checkpoint", trigger: "manual", atBoundary: t.session.state.phase !== "playerTurn" } };
}

export function submitCheck(t: TrainingTable, answer: CheckpointAnswer, opts: TrainingOptions, at: number): TrainingTable {
  const p = t.pending;
  if (!p) throw new IllegalActionError("No count check is pending.");
  const state = t.session.state;
  const actual = actualFromView(buildTableView(state), opts.rounding);
  const grade = gradeCheckpoint(actual, answer, {
    rounding: opts.rounding,
    askTrueCount: opts.checkpoints.askTrueCount,
    askDecks: opts.checkpoints.askDecks,
    decks: state.rules.decks,
  });
  const record: CheckpointRecord = {
    round: state.roundNumber,
    trigger: p.kind === "end-of-shoe" ? "end-of-shoe" : p.trigger,
    atBoundary: p.kind === "end-of-shoe" ? true : p.atBoundary,
    actual,
    answer,
    grade,
  };
  const next: TrainingTable = { ...t, tracker: recordCheckpoint(noteMode(t.tracker, opts.mode), record), lastCheckpoint: record, roundsSinceCheck: 0, pending: null };
  return p.kind === "end-of-shoe" ? finalizeShoe(next, p.termination, opts, at) : next;
}

/** Decline a check. It is recorded as unanswered, never as correct. */
export function skipCheck(t: TrainingTable, opts: TrainingOptions, at: number): TrainingTable {
  return submitCheck(t, { runningCount: null, trueCount: null, decks: null }, opts, at);
}

function finalizeShoe(t: TrainingTable, termination: ShoeTermination, opts: TrainingOptions, at: number): TrainingTable {
  const state = t.session.state;
  const report = buildShoeReport(t.tracker, {
    termination,
    at,
    finalActual: buildTableView(state).count.runningCount,
    keepDecisions: opts.keepDecisionDetail,
  });
  return {
    ...t,
    completedReport: report,
    pending: null,
    roundsSinceCheck: 0,
    tracker: createTracker(state.shoeNumber + 1, state.rules, opts.mode, at),
  };
}

/** Close out a partly played shoe (e.g. the table is reset). Null if no rounds were played. */
export function abandonShoe(t: TrainingTable, opts: TrainingOptions, at: number): ShoeReport | null {
  if (t.tracker.rounds === 0) return null;
  return buildShoeReport(t.tracker, {
    termination: "abandoned",
    at,
    finalActual: buildTableView(t.session.state).count.runningCount,
    keepDecisions: opts.keepDecisionDetail,
  });
}

export function withSession(t: TrainingTable, session: TableSession): TrainingTable {
  return { ...t, session };
}
