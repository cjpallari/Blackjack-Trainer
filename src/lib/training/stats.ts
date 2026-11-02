import type { HandCategory, PlayerAction } from "../blackjack/strategy";
import type { RCDrillType } from "./running-count";

export interface Tally {
  attempts: number;
  correct: number;
}

const tally = (): Tally => ({ attempts: 0, correct: 0 });

export function accuracy(t: Tally): number | null {
  return t.attempts ? t.correct / t.attempts : null;
}

function bump(t: Tally, correct: boolean): Tally {
  return { attempts: t.attempts + 1, correct: t.correct + (correct ? 1 : 0) };
}

export interface MissRecord {
  attempts: number;
  misses: number;
  lastChosen?: PlayerAction;
  /** The correct play when last missed (under the rules in force then). */
  lastBest?: PlayerAction;
  lastMissedAt?: number;
}

export interface DayBucket {
  date: string;
  bs: Tally;
  rc: Tally;
  tc: Tally;
}

export interface RCAttempt {
  at: number;
  type: RCDrillType;
  expected: number;
  answer: number;
  ms: number;
  cards: number;
}

export interface Stats {
  version: 1;
  bs: {
    overall: Tally;
    byCategory: Record<HandCategory, Tally>;
    streak: number;
    bestStreak: number;
    totalMs: number;
    /** Sum of EV given up by incorrect decisions, per unit bet. */
    evLost: number;
    scenarios: Record<string, MissRecord>;
  };
  rc: {
    drills: Tally;
    flashcards: Tally;
    totalMs: number;
    bestDeckMs: number | null;
    bestDoubleDeckMs: number | null;
    recent: RCAttempt[];
  };
  tc: {
    calculate: Tally;
    deckEstimate: Tally;
    estimateCalculation: Tally;
    estimateOverall: Tally;
    totalMs: number;
    timeouts: number;
  };
  sessions: Record<"bs" | "rc" | "tc", number>;
  history: DayBucket[];
}

export function emptyStats(): Stats {
  return {
    version: 1,
    bs: {
      overall: tally(),
      byCategory: { hard: tally(), soft: tally(), pair: tally() },
      streak: 0,
      bestStreak: 0,
      totalMs: 0,
      evLost: 0,
      scenarios: {},
    },
    rc: { drills: tally(), flashcards: tally(), totalMs: 0, bestDeckMs: null, bestDoubleDeckMs: null, recent: [] },
    tc: { calculate: tally(), deckEstimate: tally(), estimateCalculation: tally(), estimateOverall: tally(), totalMs: 0, timeouts: 0 },
    sessions: { bs: 0, rc: 0, tc: 0 },
    history: [],
  };
}

export function parseStats(raw: unknown): Stats | null {
  if (!raw || typeof raw !== "object" || (raw as { version?: unknown }).version !== 1) return null;
  const base = emptyStats();
  const r = raw as Partial<Stats>;
  return {
    ...base,
    ...r,
    bs: { ...base.bs, ...r.bs, byCategory: { ...base.bs.byCategory, ...r.bs?.byCategory } },
    rc: { ...base.rc, ...r.rc },
    tc: { ...base.tc, ...r.tc },
    sessions: { ...base.sessions, ...r.sessions },
    history: Array.isArray(r.history) ? r.history : [],
  };
}

export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function withDay(stats: Stats, at: number, field: "bs" | "rc" | "tc", correct: boolean): DayBucket[] {
  const key = dayKey(at);
  const history = stats.history.slice();
  let i = history.findIndex((b) => b.date === key);
  if (i < 0) {
    history.push({ date: key, bs: tally(), rc: tally(), tc: tally() });
    history.sort((a, b) => a.date.localeCompare(b.date));
    i = history.findIndex((b) => b.date === key);
  }
  history[i] = { ...history[i], [field]: bump(history[i][field], correct) };
  return history.slice(-120);
}

export function recordBasicStrategy(
  s: Stats,
  e: { at: number; key: string; category: HandCategory; chosen: PlayerAction; best?: PlayerAction; correct: boolean; ms: number; evLoss: number },
): Stats {
  const prev = s.bs.scenarios[e.key] ?? { attempts: 0, misses: 0 };
  const streak = e.correct ? s.bs.streak + 1 : 0;
  return {
    ...s,
    bs: {
      overall: bump(s.bs.overall, e.correct),
      byCategory: { ...s.bs.byCategory, [e.category]: bump(s.bs.byCategory[e.category], e.correct) },
      streak,
      bestStreak: Math.max(s.bs.bestStreak, streak),
      totalMs: s.bs.totalMs + e.ms,
      evLost: s.bs.evLost + e.evLoss,
      scenarios: {
        ...s.bs.scenarios,
        [e.key]: e.correct
          ? { ...prev, attempts: prev.attempts + 1 }
          : { attempts: prev.attempts + 1, misses: prev.misses + 1, lastChosen: e.chosen, lastBest: e.best, lastMissedAt: e.at },
      },
    },
    history: withDay(s, e.at, "bs", e.correct),
  };
}

/**
 * Scenarios still needing work: missed at least once and not answered
 * correctly enough since. Most-missed first.
 */
export function missedScenarios(s: Stats): { key: string; rec: MissRecord }[] {
  return Object.entries(s.bs.scenarios)
    .filter(([, r]) => r.misses > 0 && r.misses / r.attempts >= 0.2)
    .sort((a, b) => b[1].misses - a[1].misses || b[1].misses / b[1].attempts - a[1].misses / a[1].attempts)
    .map(([key, rec]) => ({ key, rec }));
}

export function recordRcDrill(s: Stats, a: RCAttempt): Stats {
  const correct = a.answer === a.expected;
  const isDeck = a.type === "deck" || a.type === "doubleDeck";
  const bestField = a.type === "deck" ? "bestDeckMs" : "bestDoubleDeckMs";
  const prevBest = isDeck ? s.rc[bestField] : null;
  return {
    ...s,
    rc: {
      ...s.rc,
      drills: bump(s.rc.drills, correct),
      totalMs: s.rc.totalMs + a.ms,
      ...(isDeck && correct && (prevBest === null || a.ms < prevBest) ? { [bestField]: a.ms } : {}),
      recent: [...s.rc.recent, a].slice(-100),
    },
    history: withDay(s, a.at, "rc", correct),
  };
}

export function recordRcFlashcard(s: Stats, at: number, correct: boolean, ms: number): Stats {
  return {
    ...s,
    rc: { ...s.rc, flashcards: bump(s.rc.flashcards, correct), totalMs: s.rc.totalMs + ms },
    history: withDay(s, at, "rc", correct),
  };
}

export function recordTc(
  s: Stats,
  e: { at: number; mode: "calculate" | "estimate"; tcCorrect: boolean; deckCorrect?: boolean; calculationCorrect?: boolean; ms: number; timedOut: boolean },
): Stats {
  const tc = { ...s.tc, totalMs: s.tc.totalMs + e.ms, timeouts: s.tc.timeouts + (e.timedOut ? 1 : 0) };
  if (e.mode === "calculate") tc.calculate = bump(tc.calculate, e.tcCorrect);
  else {
    tc.estimateOverall = bump(tc.estimateOverall, e.tcCorrect);
    if (e.deckCorrect !== undefined) tc.deckEstimate = bump(tc.deckEstimate, e.deckCorrect);
    if (e.calculationCorrect !== undefined) tc.estimateCalculation = bump(tc.estimateCalculation, e.calculationCorrect);
  }
  return { ...s, tc, history: withDay(s, e.at, "tc", e.tcCorrect) };
}

export function recordSession(s: Stats, mode: "bs" | "rc" | "tc"): Stats {
  return { ...s, sessions: { ...s.sessions, [mode]: s.sessions[mode] + 1 } };
}
