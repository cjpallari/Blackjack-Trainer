/**
 * Hi-Lo index generation with the exact finite-shoe analyzer.
 *
 * Model of "the remaining shoe at true count t with D decks left": D fresh
 * decks, with RC = t·D shifted in proportion to the Hi-Lo tags: each low rank
 * (2–6) loses RC/10 cards; the high ranks gain RC/2 cards in proportion to
 * their share (tens 0.4·RC, aces 0.1·RC); neutral ranks are unchanged, so
 * exactly D decks remain. Counts are fractional (see ca.ts).
 *
 * For each cell, the EV of every competing action is computed at integer
 * true counts −10..+10 and at two depths (≈60% and ≈30% of the shoe left).
 * Crossing points between the best actions are found by linear
 * interpolation. A crossing that moves by more than one true count between
 * the two depths is marked unstable and is not used.
 *
 * Splits use the analyzer's no-resplit model, so split indices are
 * conservative (splitting is slightly undervalued).
 */
import { POINT_RANKS, type PointRank } from "../cards";
import { CELL_BY_ID as CELLS, type DeviationAction, type DeviationCell } from "../deviations/definitions";
import { UpcardAnalyzer } from "./ca";

export const TC_GRID: readonly number[] = Array.from({ length: 21 }, (_, i) => i - 10);
export const STABILITY_LIMIT = 1;

export function compositionAtTrueCount(decksRemaining: number, tc: number): Float64Array {
  const c = new Float64Array(11);
  const rc = tc * decksRemaining;
  for (let r = 1; r <= 9; r++) c[r] = 4 * decksRemaining;
  c[10] = 16 * decksRemaining;
  for (let r = 2; r <= 6; r++) c[r] -= rc / 10;
  c[10] += 0.4 * rc;
  c[1] += 0.1 * rc;
  return c;
}

export function depthsFor(decks: number): [number, number] {
  return [Math.max(0.75, Math.round(decks * 0.6 * 4) / 4), Math.max(0.75, Math.round(decks * 0.3 * 4) / 4)];
}

export type ActionEVMap = Partial<Record<DeviationAction, number>>;

/** EVs of each candidate action for a cell at one composition (per unit bet; insurance per unit insured). */
export function cellEVs(cell: DeviationCell, comp: Float64Array, h17: boolean, das: boolean): ActionEVMap {
  const up = cell.up;
  const c = Float64Array.from(comp);
  c[up] -= 1;
  if (cell.kind === "insurance") {
    // Two average player cards are also out of the shoe.
    const n = c.reduce((a, b) => a + b, 0);
    const tens = c[10] * (1 - 2 / n);
    const p = tens / (n - 2);
    return { insure: 3 * p - 1, decline: 0 };
  }
  const hand = cell.hand!;
  const a = new UpcardAnalyzer(c, up, h17);
  const out: ActionEVMap = {};
  if (hand.kind === "pair") {
    const r = hand.rank;
    const e = a.handEVs([r, r]);
    const cs = Float64Array.from(c);
    cs[r] -= 1;
    const sp = new UpcardAnalyzer(cs, up, h17).splitEVs(r);
    out.stand = e.stand;
    out.hit = e.hit;
    out.double = e.double;
    out.split = das ? sp.splitDAS : sp.splitNoDAS;
  } else {
    // Probability-weighted average over two-card, non-pair, ace-free compositions of the total.
    let w = 0;
    let stand = 0;
    let hit = 0;
    let double = 0;
    for (const i of POINT_RANKS) {
      for (const j of POINT_RANKS) {
        if (i >= j || i === 1 || i + j !== hand.total) continue;
        const wi = 2 * Math.max(0, c[i]) * Math.max(0, c[j]);
        if (wi === 0) continue;
        const e = a.handEVs([i as PointRank, j as PointRank]);
        w += wi;
        stand += wi * e.stand;
        hit += wi * e.hit;
        double += wi * e.double;
      }
    }
    out.stand = stand / w;
    out.hit = hit / w;
    out.double = double / w;
  }
  out.surrender = -0.5;
  return out;
}

export interface CellCurves {
  readonly id: string;
  /** EVs at each TC_GRID point, per depth. */
  readonly depths: readonly { readonly decksRemaining: number; readonly evs: readonly ActionEVMap[] }[];
}

export function cellCurves(cell: DeviationCell, decks: number, h17: boolean, das: boolean): CellCurves {
  return {
    id: cell.id,
    depths: depthsFor(decks).map((d) => ({
      decksRemaining: d,
      evs: TC_GRID.map((t) => cellEVs(cell, compositionAtTrueCount(d, t), h17, das)),
    })),
  };
}

export interface Band {
  readonly action: DeviationAction;
  /** Upper TC bound (exclusive) of this band; null for the last band. */
  readonly upTo: number | null;
}

function crossing(t0: number, d0: number, t1: number, d1: number): number {
  return t0 + ((t1 - t0) * d0) / (d0 - d1);
}

/** Best-action bands across the TC grid for an allowed action set. */
export function bandsFromCurve(evs: readonly ActionEVMap[], allowed: readonly DeviationAction[]): Band[] {
  const best = evs.map((e) => {
    let a: DeviationAction = allowed[0];
    for (const x of allowed) if ((e[x] ?? -Infinity) > (e[a] ?? -Infinity)) a = x;
    return a;
  });
  const bands: Band[] = [];
  for (let i = 1; i < best.length; i++) {
    if (best[i] === best[i - 1]) continue;
    const A = best[i - 1];
    const B = best[i];
    const d0 = evs[i - 1][B]! - evs[i - 1][A]!;
    const d1 = evs[i][B]! - evs[i][A]!;
    bands.push({ action: A, upTo: Math.round(crossing(TC_GRID[i - 1], d0, TC_GRID[i], d1) * 100) / 100 });
  }
  bands.push({ action: best[best.length - 1], upTo: null });
  return bands;
}

/** Crossing TC where `above` overtakes `below`, or null if not within the grid. */
export function pairThreshold(evs: readonly ActionEVMap[], above: DeviationAction, below: DeviationAction): number | null {
  for (let i = 1; i < evs.length; i++) {
    const d0 = evs[i - 1][above]! - evs[i - 1][below]!;
    const d1 = evs[i][above]! - evs[i][below]!;
    if (d0 < 0 && d1 >= 0) return Math.round(crossing(TC_GRID[i - 1], d0, TC_GRID[i], d1) * 100) / 100;
  }
  return null;
}

export type CellStatus = "active" | "no-deviation" | "unstable";

export interface ComputedCell {
  readonly id: string;
  readonly status: CellStatus;
  /** Bands averaged across the two depths (only meaningful when active). */
  readonly bands: readonly Band[];
  readonly depthBands: readonly (readonly Band[])[];
  readonly note: string | null;
}

/** Combine the two depths' bands into one index set entry. */
export function combineDepths(id: string, depthBands: readonly (readonly Band[])[]): ComputedCell {
  const [a, b] = depthBands;
  const sameShape = a.length === b.length && a.every((x, i) => x.action === b[i].action);
  if (!sameShape) {
    return { id, status: "unstable", bands: a, depthBands, note: "The best play changes in a different pattern at different shoe depths." };
  }
  if (a.length === 1) return { id, status: "no-deviation", bands: a, depthBands, note: "No change of play between true counts −10 and +10." };
  const drift = Math.max(...a.map((x, i) => (x.upTo === null ? 0 : Math.abs(x.upTo - b[i].upTo!))));
  const bands = a.map((x, i) => ({ action: x.action, upTo: x.upTo === null ? null : Math.round(((x.upTo + b[i].upTo!) / 2) * 100) / 100 }));
  if (drift > STABILITY_LIMIT)
    return { id, status: "unstable", bands, depthBands, note: `The index moves by ${drift.toFixed(1)} true counts between shoe depths.` };
  return { id, status: "active", bands, depthBands, note: null };
}

export function allowedActions(cell: DeviationCell, surrender: boolean): DeviationAction[] {
  return cell.actions.filter((a) => a !== "surrender" || surrender);
}

export interface PairCheck {
  readonly group: "I18" | "Fab4";
  readonly above: DeviationAction;
  readonly below: DeviationAction;
  /** Pairwise crossing (above vs below only) at each depth; null if outside ±10. */
  readonly depthThresholds: readonly (number | null)[];
}

export interface IndexSetEntry extends ComputedCell {
  readonly pairs: readonly PairCheck[];
}

export interface IndexSetKey {
  readonly decks: number;
  readonly h17: boolean;
  readonly das: boolean;
  readonly surrender: boolean;
}

export function buildIndexSet(key: IndexSetKey, curves: readonly CellCurves[]) {
  return {
    ...key,
    depths: depthsFor(key.decks),
    cells: curves.map((c): IndexSetEntry => {
      const cell = CELLS.get(c.id)!;
      const allowed = allowedActions(cell, key.surrender);
      return {
        ...combineDepths(c.id, c.depths.map((d) => bandsFromCurve(d.evs, allowed))),
        pairs: cell.published.map((p) => ({
          group: p.group,
          above: p.above,
          below: p.below,
          depthThresholds: c.depths.map((d) => pairThreshold(d.evs, p.above, p.below)),
        })),
      };
    }),
  };
}
