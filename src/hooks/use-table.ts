"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings, useShoeHistory, useStats } from "@/hooks/use-store";
import { IllegalActionError, type GameEvent } from "@/lib/blackjack/engine";
import { defaultRng } from "@/lib/blackjack/rng";
import type { PlayerAction } from "@/lib/blackjack/strategy";
import { buildTableView, eventWeight, type TableView } from "@/lib/blackjack/table-view";
import { betError, emptySessionStats, rebuy, type SessionStats } from "@/lib/blackjack/table-session";
import type { AnimationSpeed } from "@/lib/storage/stores";
import { recordSession, recordSimRound } from "@/lib/training/stats";
import { actualFromView, type CheckpointActual, type CheckpointAnswer } from "@/lib/training/table/count-checks";
import { hintFromView, type DecisionRecord, type InsuranceRecord, type TableHint } from "@/lib/training/table/decisions";
import { addReport } from "@/lib/training/table/history";
import { assistanceFor, type Assistance } from "@/lib/training/table/modes";
import type { CheckpointRecord, DeviationSetInfo, ShoeReport } from "@/lib/training/table/shoe-tracker";
import {
  abandonShoe,
  canRequestCheck,
  createTrainingTable,
  deviationContext,
  trainingInsurance,
  requestCheck,
  skipCheck,
  submitCheck,
  trainingAct,
  trainingDeal,
  withSession,
  type PendingCheck,
  type TrainingOptions,
  type TrainingTable,
} from "@/lib/training/table/training-table";

export const SPEED_MS: Record<AnimationSpeed, number> = { instant: 0, fast: 140, normal: 380, slow: 750 };

/**
 * The live training table is kept outside React state, in module scope, so it
 * survives navigation within the app. Components receive the TableView
 * projection (no hidden-card identities) plus only the training information
 * the active mode allows.
 */
const EMPTY_STATS = emptySessionStats();
const NO_EVENTS: readonly GameEvent[] = [];

let live: { key: string; table: TrainingTable; revealed: number } | null = null;
const rng = defaultRng();

export interface TableController {
  view: TableView | null;
  stats: SessionStats;
  /** Bet error for a pending bet, or null. */
  betError: (bet: number) => string | null;
  deal: (bet: number) => void;
  act: (action: PlayerAction) => void;
  rebuy: (amount: number) => void;
  newTable: () => void;
  skipAnimation: () => void;
  animating: boolean;
  error: string | null;
  /** True when a round is in progress, so table configuration is locked. */
  locked: boolean;
  assistance: Assistance;
  /** Live count data; null unless the mode shows it (and never while a check is open). */
  hud: CheckpointActual | null;
  /** Basic and count-adjusted recommendation for your decision, if the mode shows hints. */
  hint: TableHint | null;
  /** Feedback on your last decision, if the mode gives it immediately. */
  decisionFeedback: DecisionRecord | null;
  insuranceFeedback: InsuranceRecord | null;
  /** Insurance offer (dealer shows an Ace), with the maximum stake. */
  insuranceOffer: { max: number } | null;
  insure: (amount: number) => void;
  /** Index set in use for this shoe, or why deviations are not graded. */
  deviationSet: DeviationSetInfo | null;
  /** A count check to answer now (shown only once the table has settled). */
  pending: PendingCheck | null;
  canCheck: boolean;
  requestCheck: () => void;
  submitCheck: (a: CheckpointAnswer) => void;
  skipCheck: () => void;
  /** Result of the last check, if the mode gives checkpoint feedback immediately. */
  checkpointFeedback: CheckpointRecord | null;
  /** True right after a check was recorded in a deferred-feedback mode. */
  checkpointRecorded: boolean;
  /** Undealt cards, for the deck-estimation question; only when deck assistance is enabled. */
  deckAssistCards: number | null;
  report: ShoeReport | null;
  dismissReport: () => void;
  /** The shoe being tracked (advances as soon as the previous shoe's report is complete). */
  shoeNumber: number;
  shoeRounds: number;
  shoeDecisions: number;
}

export function useTableController(): TableController {
  const [settings] = useSettings();
  const [, setStats] = useStats();
  const [, setHistory] = useShoeHistory();
  const { rules, sim } = settings;
  const training = sim.training;
  const key = useMemo(() => JSON.stringify([rules, sim.humanSeat, sim.startingBankroll]), [rules, sim.humanSeat, sim.startingBankroll]);
  const opts: TrainingOptions = useMemo(
    () => ({
      mode: training.mode,
      intermediate: training.intermediate,
      checkpoints: training.checkpoints,
      rounding: settings.rounding,
      keepDecisionDetail: training.keepDecisionDetail,
      deviations: training.deviations,
    }),
    [training, settings.rounding],
  );
  const assistance = assistanceFor(opts.mode, opts.intermediate);

  const [, setVersion] = useState(0);
  const [revealed, setRevealedState] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [reportDismissed, setReportDismissed] = useState<string | null>(null);
  const recordedRound = useRef<number>(0);
  const savedReports = useRef(new Set<string>());

  const bump = () => setVersion((v) => v + 1);
  const setRevealed = useCallback((n: number) => {
    if (live) live.revealed = n;
    setRevealedState(n);
  }, []);

  const saveReport = useCallback(
    (r: ShoeReport | null) => {
      if (!r || savedReports.current.has(r.id)) return;
      savedReports.current.add(r.id);
      setHistory((h) => addReport(h, r));
    },
    [setHistory],
  );

  const makeTable = useCallback(() => {
    if (live) saveReport(abandonShoe(live.table, opts, Date.now()));
    const table = createTrainingTable({ rules, humanSeat: sim.humanSeat, bankroll: sim.startingBankroll }, opts, rng, Date.now());
    live = { key, table, revealed: table.session.state.log.length };
    recordedRound.current = 0;
    setRevealedState(live.revealed);
    setError(null);
    bump();
  }, [key, rules, sim.humanSeat, sim.startingBankroll, opts, saveReport]);

  // Create (or reuse) the table client-side once settings have loaded.
  useEffect(() => {
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    if (!live || live.key !== key) {
      // New rules or seating: start a fresh table. An unfinished round is
      // abandoned; its bets were never deducted, so bankrolls are unaffected.
      makeTable();
    } else {
      recordedRound.current = live.table.session.lastRound?.roundNumber ?? 0;
      setRevealedState(live.revealed);
      bump();
    }
    // makeTable changes with training options; only the table key should rebuild the table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, key]);

  const table = live?.key === key ? live.table : null;
  const session = table?.session ?? null;
  const log = useMemo(() => session?.state.log ?? NO_EVENTS, [session]);
  const base = SPEED_MS[sim.animation];

  // Reveal events one at a time.
  useEffect(() => {
    if (!session || revealed >= log.length) return;
    if (base === 0) {
      setRevealed(log.length);
      return;
    }
    const id = setTimeout(() => setRevealed(revealed + 1), eventWeight(log[revealed]) * base);
    return () => clearTimeout(id);
  }, [session, revealed, log, base, setRevealed]);

  const view = useMemo(() => (session ? buildTableView(session.state, revealed) : null), [session, revealed]);
  const caughtUp = !!view && revealed >= log.length;

  // Session stats change in the engine as soon as a round resolves; only show
  // them once the result is visible on the table.
  const shownStats = useRef<SessionStats>(EMPTY_STATS);
  if (!session) shownStats.current = EMPTY_STATS;
  else if (view?.settled || session.state.phase !== "roundOver") shownStats.current = session.stats;

  // Persist results once the player has actually seen them.
  useEffect(() => {
    if (!view?.settled || !session?.lastRound) return;
    if (session.lastRound.roundNumber === recordedRound.current) return;
    recordedRound.current = session.lastRound.roundNumber;
    const r = session.lastRound;
    setStats((s) => {
      const out = recordSimRound(s, r);
      return r.roundNumber === 1 ? recordSession(out, "sim") : out;
    });
  }, [view?.settled, session, setStats]);

  const report = caughtUp ? (table?.completedReport ?? null) : null;
  useEffect(() => saveReport(report), [report, saveReport]);

  const run = (fn: (t: TrainingTable) => TrainingTable, resetReveal: boolean) => {
    if (!live) return;
    try {
      live.table = fn(live.table);
      if (resetReveal) setRevealed(0);
      setError(null);
      bump();
    } catch (e) {
      if (e instanceof IllegalActionError) setError(e.message);
      else throw e;
    }
  };

  // A pending check is only presented once the table has visibly settled.
  const pending = caughtUp ? (table?.pending ?? null) : null;
  const checkOpen = pending !== null;
  const lastCp = table?.lastCheckpoint ?? null;

  return {
    view,
    stats: shownStats.current,
    betError: (bet) => (!session ? "Table not ready." : table?.pending ? "Finish the count check first." : betError(session, bet)),
    deal: (bet) => run((t) => trainingDeal(t, bet, opts, rng, Date.now()), true),
    act: (action) => {
      if (checkOpen || !view?.available.includes(action)) return;
      run((t) => trainingAct(t, action, opts, rng, Date.now()), false);
    },
    rebuy: (amount) => run((t) => withSession(t, rebuy(t.session, amount)), false),
    newTable: makeTable,
    skipAnimation: () => setRevealed(log.length),
    animating: revealed < log.length,
    error,
    locked: session?.state.phase === "playerTurn" || session?.state.phase === "insurance" || revealed < log.length || checkOpen,
    assistance,
    // Built from the animated view, so it changes only as cards become visible.
    hud: assistance.liveCount && view && !checkOpen ? actualFromView(view, opts.rounding) : null,
    hint: assistance.strategyHint && view && caughtUp && !checkOpen ? hintFromView(view, rules, deviationContext(rules, opts)) : null,
    decisionFeedback: assistance.decisionFeedback === "immediate" ? (table?.lastDecision ?? null) : null,
    insuranceFeedback: assistance.decisionFeedback === "immediate" ? (table?.lastInsurance ?? null) : null,
    insuranceOffer: !checkOpen ? (view?.insuranceOffer ?? null) : null,
    insure: (amount) => {
      if (checkOpen || !view?.insuranceOffer) return;
      run((t) => trainingInsurance(t, amount, opts, rng, Date.now()), false);
    },
    deviationSet: table?.tracker.deviationSet ?? null,
    pending,
    canCheck: !!table && caughtUp && canRequestCheck(table, opts),
    requestCheck: () => run((t) => requestCheck(t, opts), false),
    submitCheck: (a) => run((t) => submitCheck(t, a, opts, Date.now()), false),
    skipCheck: () => run((t) => skipCheck(t, opts, Date.now()), false),
    // End-of-shoe answers are reviewed in the shoe report instead.
    checkpointFeedback: assistance.checkpointFeedback === "immediate" && !checkOpen && lastCp?.trigger !== "end-of-shoe" ? lastCp : null,
    checkpointRecorded: assistance.checkpointFeedback === "deferred" && !checkOpen && lastCp !== null && lastCp.trigger !== "end-of-shoe",
    deckAssistCards: checkOpen && opts.checkpoints.deckAssist && view ? view.shoe.cardsInShoe : null,
    report: report && report.id !== reportDismissed ? report : null,
    dismissReport: () => report && setReportDismissed(report.id),
    shoeNumber: table?.tracker.shoeNumber ?? 1,
    shoeRounds: table?.tracker.rounds ?? 0,
    shoeDecisions: table?.tracker.decisions.length ?? 0,
  };
}
