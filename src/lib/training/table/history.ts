/**
 * Saved end-of-shoe reports. Versioned; malformed or unknown entries are
 * dropped on load. Detailed per-decision logs are kept only for the most
 * recent shoes to bound localStorage growth.
 */
import type { ShoeReport } from "./shoe-tracker";

export interface ShoeHistory {
  readonly version: 1;
  readonly reports: readonly ShoeReport[];
}

export const MAX_REPORTS = 200;
export const MAX_DETAILED_REPORTS = 20;

export const emptyShoeHistory = (): ShoeHistory => ({ version: 1, reports: [] });

function isReport(r: unknown): r is ShoeReport {
  if (!r || typeof r !== "object") return false;
  const x = r as Partial<ShoeReport>;
  return (
    x.version === 1 &&
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

export function parseShoeHistory(raw: unknown): ShoeHistory | null {
  if (!raw || typeof raw !== "object" || (raw as { version?: unknown }).version !== 1) return null;
  const reports = (raw as { reports?: unknown }).reports;
  return { version: 1, reports: Array.isArray(reports) ? reports.filter(isReport) : [] };
}

export function addReport(h: ShoeHistory, report: ShoeReport): ShoeHistory {
  if (h.reports.some((r) => r.id === report.id)) return h;
  const all = [...h.reports, report].slice(-MAX_REPORTS);
  const cutoff = all.length - MAX_DETAILED_REPORTS;
  return {
    version: 1,
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
  };
}
