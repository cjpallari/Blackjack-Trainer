/**
 * Saved end-of-shoe reports. Versioned; malformed or unknown entries are
 * dropped on load. Detailed per-decision logs are kept only for the most
 * recent shoes to bound localStorage growth.
 */
import { migrateReport, type CellDeviationStats, type ShoeReport } from "./shoe-tracker";

export interface ShoeHistory {
  readonly version: 2;
  readonly reports: readonly ShoeReport[];
}

export const MAX_REPORTS = 200;
export const MAX_DETAILED_REPORTS = 20;

export const emptyShoeHistory = (): ShoeHistory => ({ version: 2, reports: [] });

function isReport(r: unknown): r is ShoeReport {
  if (!r || typeof r !== "object") return false;
  const x = r as Partial<ShoeReport>;
  return (
    x.version === 2 &&
    typeof x.id === "string" &&
    typeof x.endedAt === "number" &&
    typeof x.decks === "number" &&
    !!x.counting &&
    typeof x.counting.valid === "boolean" &&
    !!x.strategy &&
    typeof x.strategy.graded === "number" &&
    !!x.shoe &&
    typeof x.shoe.rounds === "number" &&
    Array.isArray(x.progression) &&
    Array.isArray(x.estimates)
  );
}

/** Loads version 1 (Phase 6) and version 2 histories; reports are upgraded to version 2. */
export function parseShoeHistory(raw: unknown): ShoeHistory | null {
  const v = (raw as { version?: unknown } | null)?.version;
  if (!raw || typeof raw !== "object" || (v !== 1 && v !== 2)) return null;
  const reports = (raw as { reports?: unknown }).reports;
  return { version: 2, reports: Array.isArray(reports) ? reports.map(migrateReport).filter(isReport) : [] };
}

export function addReport(h: ShoeHistory, report: ShoeReport): ShoeHistory {
  if (h.reports.some((r) => r.id === report.id)) return h;
  const all = [...h.reports, report].slice(-MAX_REPORTS);
  const cutoff = all.length - MAX_DETAILED_REPORTS;
  return {
    version: 2,
    reports: all.map((r, i) => {
      if (i >= cutoff || !r.decisions) return r;
      const { decisions: _drop, ...rest } = r;
      void _drop;
      return rest;
    }),
  };
}

export interface HistoryAggregate {
  readonly shoes: number;
  /** Shoes counted in counting metrics (not interrupted). */
  readonly validShoes: number;
  readonly excludedShoes: number;
  readonly checkpoints: number;
  readonly rcCorrect: number;
  readonly tcAnswered: number;
  readonly tcCorrect: number;
  readonly deckEstimates: number;
  readonly deckCorrect: number;
  readonly finalAnswered: number;
  readonly finalCorrect: number;
  readonly decisions: number;
  readonly decisionsCorrect: number;
  readonly estimatedEvLost: number;
  /** Shoes graded with an index set. */
  readonly deviationShoes: number;
  readonly deviationOpportunities: number;
  readonly deviationFollowed: number;
  readonly deviationMissed: number;
  readonly wrongDeviations: number;
  readonly byCell: readonly CellDeviationStats[];
  /** Betting-training wagers and how many matched the ramp. */
  readonly betDecisions: number;
  readonly betCorrect: number;
}

/** Totals across shoes. Counting metrics use only valid (uninterrupted) shoes. */
export function aggregateHistory(reports: readonly ShoeReport[]): HistoryAggregate {
  const valid = reports.filter((r) => r.counting.valid);
  const sum = (rs: readonly ShoeReport[], f: (r: ShoeReport) => number) => rs.reduce((n, r) => n + f(r), 0);
  return {
    shoes: reports.length,
    validShoes: valid.length,
    excludedShoes: reports.length - valid.length,
    checkpoints: sum(valid, (r) => r.counting.answered),
    rcCorrect: sum(valid, (r) => r.counting.correct),
    tcAnswered: sum(valid, (r) => r.counting.tcAnswered),
    tcCorrect: sum(valid, (r) => r.counting.tcCorrect),
    deckEstimates: sum(valid, (r) => r.counting.deckEstimates),
    deckCorrect: sum(valid, (r) => r.counting.deckCorrect),
    finalAnswered: valid.filter((r) => r.counting.finalSubmitted !== null).length,
    finalCorrect: valid.filter((r) => r.counting.finalSubmitted !== null && r.counting.finalSubmitted === r.counting.finalActual).length,
    decisions: sum(reports, (r) => r.strategy.graded),
    decisionsCorrect: sum(reports, (r) => r.strategy.correct),
    estimatedEvLost: sum(reports, (r) => r.strategy.estimatedEvLost),
    ...deviationTotals(reports),
    betDecisions: sum(reports, (r) => r.betting?.decisions ?? 0),
    betCorrect: sum(reports, (r) => r.betting?.correct ?? 0),
  };
}

function deviationTotals(reports: readonly ShoeReport[]) {
  const dev = reports.flatMap((r) => (r.deviations ? [r.deviations] : []));
  const cells = new Map<string, { -readonly [K in keyof CellDeviationStats]: CellDeviationStats[K] }>();
  for (const d of dev) {
    for (const c of d.byCell) {
      const m = cells.get(c.cellId) ?? { ...c, decisions: 0, correct: 0, opportunities: 0, followed: 0, missed: 0, wrong: 0 };
      m.decisions += c.decisions;
      m.correct += c.correct;
      m.opportunities += c.opportunities;
      m.followed += c.followed;
      m.missed += c.missed;
      m.wrong += c.wrong;
      cells.set(c.cellId, m);
    }
  }
  return {
    deviationShoes: dev.length,
    deviationOpportunities: dev.reduce((n, d) => n + d.opportunities, 0),
    deviationFollowed: dev.reduce((n, d) => n + d.followed, 0),
    deviationMissed: dev.reduce((n, d) => n + d.missed, 0),
    wrongDeviations: dev.reduce((n, d) => n + d.wrongDeviations, 0),
    byCell: [...cells.values()].sort((a, b) => b.missed + b.wrong - (a.missed + a.wrong)),
  };
}
