/**
 * Versioned Hi-Lo deviation index registry and the single evaluation path
 * used by both the Deviation Trainer and the table.
 *
 * Index sets are keyed by counting system, deck count, H17/S17, double after
 * split and surrender. Double restrictions and insurance availability are
 * applied per play at evaluation time. The true-count conversion convention
 * is the user's rounding setting; each integer true count stands for a band
 * of raw true counts, and the play for that integer is the play at the band's
 * representative value (see `bucketRepresentative`).
 */
import { pointRank, type PointRank, type Rank } from "../cards";
import { trueCount, type TrueCountRounding } from "../counting";
import { handValueFromRanks } from "../hand";
import { canDoubleTotal, type TableRules } from "../rules";
import { evaluateDecision, strategyTableFor, type PlayerAction } from "../strategy";
import type { Band, IndexSetEntry, IndexSetKey } from "../analysis/index-gen";
import { CELL_BY_ID, DEVIATION_CELLS, type DeviationAction, type DeviationCell } from "./definitions";
import data from "./data/hilo-indices.json";

export const SUPPORTED_INDEX_DECKS = [2, 4, 6, 8] as const;

export const INDEX_METHOD =
  "Computed with this app's exact finite-shoe analyzer (dealer peek, hole card modelled). The remaining shoe at true count t is D decks with the " +
  "running count spread over the Hi-Lo ranks in proportion; the best play is evaluated at integer true counts −10..+10 at ~60% and ~30% of the " +
  "shoe remaining, and crossings are interpolated. Two-card hands only; splits without resplitting. Validated against the published six-deck " +
  "Illustrious 18 / Fab 4 (Wizard of Odds).";

export interface IndexSet extends IndexSetKey {
  readonly depths: readonly number[];
  readonly cells: readonly IndexSetEntry[];
}

export interface IndexFile {
  readonly version: 1;
  readonly system: "hi-lo";
  readonly method: string;
  readonly sets: readonly IndexSet[];
}

const FILE = data as unknown as IndexFile;

export type IndexSetResolution =
  | { readonly supported: true; readonly set: IndexSet; readonly convention: TrueCountRounding; readonly id: string }
  | { readonly supported: false; readonly reason: string };

export function indexSetId(k: IndexSetKey, convention: TrueCountRounding): string {
  return `hilo-v${FILE.version}:${k.decks}D-${k.h17 ? "H17" : "S17"}-${k.das ? "DAS" : "NDAS"}-${k.surrender ? "LS" : "NS"}-${convention}`;
}

export function resolveIndexSet(rules: TableRules, convention: TrueCountRounding, file: IndexFile = FILE): IndexSetResolution {
  if (rules.variant !== "standard") return { supported: false, reason: "Deviation indices exist only for the standard rules variant." };
  if (!(SUPPORTED_INDEX_DECKS as readonly number[]).includes(rules.decks)) {
    return {
      supported: false,
      reason:
        rules.decks === 1
          ? "Single-deck indices are not supported: card removal at single-deck depths is too large for the composition model used to compute indices, and no validated single-deck set is included."
          : `No validated index set for ${rules.decks} decks.`,
    };
  }
  const set = file.sets.find(
    (s) => s.decks === rules.decks && s.h17 === rules.dealerHitsSoft17 && s.das === rules.doubleAfterSplit && s.surrender === (rules.surrender === "late"),
  );
  if (!set) return { supported: false, reason: "No index set has been generated for these rules." };
  return { supported: true, set, convention, id: indexSetId(set, convention) };
}

// ---------------------------------------------------------------------------
// True-count buckets

/**
 * The raw true count an integer true count stands for under a convention:
 * the middle of the raw values that convert to it.
 * - floor: [i, i+1) → i + 0.5
 * - truncate: i > 0: [i, i+1) → i + 0.5; i < 0: (i−1, i] → i − 0.5; 0: (−1, 1) → 0
 * - nearest: [i − 0.5, i + 0.5) → i
 * - exact: the value itself (one decimal)
 */
export function bucketRepresentative(tc: number, convention: TrueCountRounding): number {
  switch (convention) {
    case "floor":
      return tc + 0.5;
    case "truncate":
      return tc > 0 ? tc + 0.5 : tc < 0 ? tc - 0.5 : 0;
    case "nearest":
    case "exact":
      return tc;
  }
}

export function actionInBands(bands: readonly Band[], raw: number): DeviationAction {
  for (const b of bands) if (b.upTo === null || raw < b.upTo) return b.action;
  return bands[bands.length - 1].action;
}

/** Smallest integer true count (under the convention) whose play is on the upper side of a crossing. */
export function integerIndex(crossing: number, convention: TrueCountRounding): number {
  if (convention === "exact") return Math.round(crossing * 10) / 10;
  for (let i = -15; i <= 15; i++) if (bucketRepresentative(i, convention) >= crossing) return i;
  return 16;
}

export function formatTc(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

const ACTION_WORD: Record<DeviationAction, string> = {
  hit: "hit",
  stand: "stand",
  double: "double",
  split: "split",
  surrender: "surrender",
  insure: "take insurance",
  decline: "decline insurance",
};

export function actionWord(a: DeviationAction): string {
  return ACTION_WORD[a];
}

/** e.g. "Stand at TC ≥ +2, otherwise hit." */
export function describeIndex(entry: IndexSetEntry, convention: TrueCountRounding): string {
  const b = entry.bands;
  if (b.length === 1) return `Always ${ACTION_WORD[b[0].action]} between TC −10 and +10.`;
  if (b.length === 2) {
    const i = integerIndex(b[0].upTo!, convention);
    const w = ACTION_WORD[b[1].action];
    return `${w[0].toUpperCase()}${w.slice(1)} at TC ≥ ${formatTc(i)}, otherwise ${ACTION_WORD[b[0].action]}.`;
  }
  const parts = [`${ACTION_WORD[b[0].action]} below TC ${formatTc(integerIndex(b[0].upTo!, convention))}`];
  for (let k = 1; k < b.length; k++) {
    const from = integerIndex(b[k - 1].upTo!, convention);
    parts.push(`${ACTION_WORD[b[k].action]} from ${formatTc(from)}`);
  }
  const s = parts.join(", ");
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}

// ---------------------------------------------------------------------------
// Matching a decision to a cell

export interface HandSituation {
  readonly cards: readonly Rank[];
  readonly up: Rank;
  readonly fromSplit: boolean;
}

/**
 * The index cell for a two-card, unsplit hand, or null. Pairs match only the
 * 10,10 cells; soft hands match none. Multi-card and split hands are not
 * matched: the indices were computed for two-card starting hands.
 */
export function matchCell(h: HandSituation): DeviationCell | null {
  if (h.cards.length !== 2 || h.fromSplit) return null;
  const ranks = h.cards.map(pointRank) as PointRank[];
  const up = pointRank(h.up);
  if (ranks[0] === ranks[1]) {
    return DEVIATION_CELLS.find((c) => c.hand?.kind === "pair" && c.hand.rank === ranks[0] && c.up === up) ?? null;
  }
  const v = handValueFromRanks(ranks);
  if (v.soft) return null;
  return DEVIATION_CELLS.find((c) => c.hand?.kind === "hard" && c.hand.total === v.total && c.up === up) ?? null;
}

export function entryFor(set: IndexSet, cellId: string): IndexSetEntry | undefined {
  return set.cells.find((c) => c.id === cellId);
}

/** Why a cell can't be used under these rules, or null if usable. */
export function cellUnavailableReason(set: IndexSet, cell: DeviationCell, rules: TableRules): string | null {
  const e = entryFor(set, cell.id);
  if (!e) return "Not in this index set.";
  if (e.status === "unstable") return e.note ?? "Index is not stable across shoe depths.";
  if (e.status === "no-deviation") return e.note ?? "No deviation in range.";
  if (cell.kind === "insurance" && !rules.insurance) return "Insurance is not offered at this table.";
  if (!set.surrender && cell.published.every((p) => p.above === "surrender")) return "This is a surrender play; the table does not offer surrender.";
  if (cell.hand?.kind === "hard" && e.bands.some((b) => b.action === "double") && !canDoubleTotal(rules, cell.hand.total, false))
    return `Doubling ${cell.hand.total} is not allowed under these rules.`;
  return null;
}

export function usableCells(set: IndexSet, rules: TableRules): DeviationCell[] {
  return DEVIATION_CELLS.filter((c) => cellUnavailableReason(set, c, rules) === null);
}

// ---------------------------------------------------------------------------
// Evaluation

export interface DeviationInput {
  readonly cell: DeviationCell;
  /** Visible running count (never includes face-down cards). */
  readonly runningCount: number;
  /** Decks remaining as the player can estimate them (quarter decks). */
  readonly decksEstimate: number;
  /** Deck-estimate tolerance: answers consistent with any estimate within it are accepted. */
  readonly deckTolerance: number;
  /** Legal actions now (for plays), used to fall back when a deviation's action isn't legal. */
  readonly legal: readonly DeviationAction[];
  /** Basic-strategy action for this exact hand under the rules. */
  readonly basic: DeviationAction;
}

export interface DeviationEvaluation {
  readonly cellId: string;
  readonly label: string;
  /** True count under the convention, from the visible count and the deck estimate. */
  readonly trueCount: number;
  readonly basic: DeviationAction;
  /** Count-adjusted play at this true count (falls back to basic if its action isn't legal). */
  readonly countAction: DeviationAction;
  /** Plays accepted as count-correct, including the other side of a borderline estimate. */
  readonly acceptable: readonly DeviationAction[];
  /** The count-adjusted play differs from basic strategy. */
  readonly deviates: boolean;
  /** The deck-estimate tolerance straddles the index. */
  readonly borderline: boolean;
  readonly indexText: string;
  /** Every play this index can call for (across all true counts). */
  readonly indexPlays: readonly DeviationAction[];
}

function countActionAt(entry: IndexSetEntry, tc: number, convention: TrueCountRounding, legal: readonly DeviationAction[], basic: DeviationAction) {
  const a = actionInBands(entry.bands, bucketRepresentative(tc, convention));
  return legal.includes(a) ? a : basic;
}

export function evaluateDeviation(set: IndexSet, convention: TrueCountRounding, input: DeviationInput): DeviationEvaluation {
  const entry = entryFor(set, input.cell.id);
  if (!entry) throw new Error(`No index for ${input.cell.id}`);
  const tc = trueCount(input.runningCount, input.decksEstimate, convention);
  const countAction = countActionAt(entry, tc, convention, input.legal, input.basic);
  const acceptable = new Set<DeviationAction>([countAction]);
  for (let d = input.decksEstimate - input.deckTolerance; d <= input.decksEstimate + input.deckTolerance + 1e-9; d += 0.25) {
    if (d < 0.25) continue;
    acceptable.add(countActionAt(entry, trueCount(input.runningCount, d, convention), convention, input.legal, input.basic));
  }
  return {
    cellId: input.cell.id,
    label: input.cell.label,
    trueCount: tc,
    basic: input.basic,
    countAction,
    acceptable: [...acceptable],
    deviates: countAction !== input.basic,
    borderline: acceptable.size > 1,
    indexText: describeIndex(entry, convention),
    indexPlays: [...new Set(entry.bands.map((b) => b.action))],
  };
}

/** Basic-strategy action for a cell's exact hand under the rules (insurance: decline). */
export function basicActionFor(rules: TableRules, cards: readonly Rank[], up: Rank, legal: readonly PlayerAction[]): PlayerAction {
  return evaluateDecision(strategyTableFor(rules), rules, { cards: cards.map(pointRank) as PointRank[], up: pointRank(up), available: legal }).best;
}

export function cellById(id: string): DeviationCell | undefined {
  return CELL_BY_ID.get(id);
}

export function indexMethod(file: IndexFile = FILE): string {
  return file.method;
}
