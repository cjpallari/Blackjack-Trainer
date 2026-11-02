"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings, useStats } from "@/hooks/use-store";
import { IllegalActionError, type GameEvent } from "@/lib/blackjack/engine";
import { defaultRng } from "@/lib/blackjack/rng";
import type { PlayerAction } from "@/lib/blackjack/strategy";
import { buildTableView, eventWeight, type TableView } from "@/lib/blackjack/table-view";
import { betError, createTableSession, dealRound, emptySessionStats, playerAction, rebuy, type SessionStats, type TableSession } from "@/lib/blackjack/table-session";
import type { AnimationSpeed } from "@/lib/storage/stores";
import { recordSession, recordSimRound } from "@/lib/training/stats";

export const SPEED_MS: Record<AnimationSpeed, number> = { instant: 0, fast: 140, normal: 380, slow: 750 };

/**
 * The live session is kept outside React state, in module scope, so it
 * survives navigation within the app. Components only ever receive the
 * TableView projection, which carries no hidden-card identities.
 */
const EMPTY_STATS = emptySessionStats();
const NO_EVENTS: readonly GameEvent[] = [];

let live: { key: string; session: TableSession; revealed: number } | null = null;
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
}

export function useTableController(): TableController {
  const [settings] = useSettings();
  const [, setStats] = useStats();
  const { rules, sim } = settings;
  const key = useMemo(() => JSON.stringify([rules, sim.humanSeat, sim.startingBankroll]), [rules, sim.humanSeat, sim.startingBankroll]);

  const [, setVersion] = useState(0);
  const [revealed, setRevealedState] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const recordedRound = useRef<number>(0);

  const bump = () => setVersion((v) => v + 1);
  const setRevealed = useCallback((n: number) => {
    if (live) live.revealed = n;
    setRevealedState(n);
  }, []);

  const makeTable = useCallback(() => {
    const session = createTableSession({ rules, humanSeat: sim.humanSeat, bankroll: sim.startingBankroll }, rng);
    live = { key, session, revealed: session.state.log.length };
    recordedRound.current = 0;
    setRevealedState(live.revealed);
    setError(null);
    bump();
  }, [key, rules, sim.humanSeat, sim.startingBankroll]);

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
      recordedRound.current = live.session.lastRound?.roundNumber ?? 0;
      setRevealedState(live.revealed);
      bump();
    }
  }, [hydrated, key, makeTable]);

  const session = live?.key === key ? live.session : null;
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

  const run = (fn: (s: TableSession) => TableSession, resetReveal: boolean) => {
    if (!live) return;
    try {
      live.session = fn(live.session);
      if (resetReveal) setRevealed(0);
      setError(null);
      bump();
    } catch (e) {
      if (e instanceof IllegalActionError) setError(e.message);
      else throw e;
    }
  };

  return {
    view,
    stats: shownStats.current,
    betError: (bet) => (session ? betError(session, bet) : "Table not ready."),
    deal: (bet) => run((s) => dealRound(s, bet, rng), true),
    act: (action) => {
      if (!view?.available.includes(action)) return;
      run((s) => playerAction(s, action, rng), false);
    },
    rebuy: (amount) => run((s) => rebuy(s, amount), false),
    newTable: makeTable,
    skipAnimation: () => setRevealed(log.length),
    animating: revealed < log.length,
    error,
    locked: session?.state.phase === "playerTurn" || revealed < log.length,
  };
}
