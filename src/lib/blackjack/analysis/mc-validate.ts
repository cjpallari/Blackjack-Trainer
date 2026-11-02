/**
 * Conditional Monte Carlo validation of Hi-Lo indices.
 *
 * Independent of the synthetic generator (index-gen.ts). Each sample is a
 * real shoe state: a full shoe is shuffled and its first k cards are taken as
 * already dealt (by exchangeability this is an exact sample of the dealt set
 * after k cards, however the rounds were played). k is uniform up to the cut
 * card, approximating how decisions are spread through a shoe.
 *
 * For a play (hand total v upcard), every two-card hand composition and the
 * upcard are enumerated from the remaining cards, weighted by the probability
 * of being dealt them. Action EVs are computed EXACTLY from the true remaining
 * composition (an offline oracle the live app never sees), then grouped by the
 * OBSERVABLE true count: (Hi-Lo of dealt cards + visible hand and upcard) ÷
 * quarter-deck estimate of the cards still in the shoe, under each rounding
 * convention. The best action per true-count bucket is therefore the optimal
 * play for a player who knows only the true count.
 */
import { POINT_RANKS, type PointRank } from "../cards";
import { roundTrueCount, type TrueCountRounding } from "../counting";
import type { DeviationAction, DeviationCell } from "../deviations/definitions";
import { seededRng, type Rng } from "../rng";
import { UpcardAnalyzer, fullShoeCounts } from "./ca";

export const MC_CONVENTIONS = ["floor", "truncate", "nearest"] as const satisfies readonly TrueCountRounding[];
export type McConvention = (typeof MC_CONVENTIONS)[number];

/** Hi-Lo tag by point rank. */
const TAG = [0, -1, 1, 1, 1, 1, 1, 0, 0, 0, -1];

/** Action columns recorded per composition. split is recorded both ways. */
export type McAction = Exclude<DeviationAction, "split"> | "splitDAS" | "splitNoDAS";

export interface McRecord {
  /** Sample (state) id, for clustered standard errors and split-half checks. */
  readonly s: number;
  /** Fraction of the shoe dealt before the hand. */
  readonly depth: number;
  /** Probability weight of this hand composition in this state. */
  readonly w: number;
  readonly tcRaw: number;
  readonly bucket: Readonly<Record<McConvention, number>>;
  readonly ev: Readonly<Partial<Record<McAction, number>>>;
}

export interface McJob {
  readonly decks: number;
  readonly h17: boolean;
  readonly penetration: number;
  readonly cell: DeviationCell;
  /** Inclusive floor-convention bucket window to fill. */
  readonly window: readonly [number, number];
  readonly quotaPerBucket: number;
  readonly maxDraws: number;
  readonly seed: number;
  /** Evaluate three-card hands of the total instead of two-card hands (diagnostic). */
  readonly threeCard?: boolean;
}

export function quarterDecks(cards: number): number {
  return Math.max(0.25, Math.round((cards / 52) * 4) / 4);
}

/** Hand compositions for a cell, as rank lists (non-pair two-card hands, or the pair). */
export function cellCompositions(cell: DeviationCell, threeCard = false): PointRank[][] {
  if (cell.kind === "insurance") {
    const out: PointRank[][] = [];
    for (const i of POINT_RANKS) for (const j of POINT_RANKS) if (i <= j) out.push([i, j]);
    return out;
  }
  const h = cell.hand!;
  if (h.kind === "pair") return [[h.rank, h.rank]];
  if (!threeCard) {
    const out: PointRank[][] = [];
    for (let i = 2; i <= 10; i++) for (let j = i + 1; j <= 10; j++) if (i + j === h.total) out.push([i as PointRank, j as PointRank]);
    return out;
  }
  // Three-card hard totals (aces count 1 and the hand must not be soft).
  const out: PointRank[][] = [];
  for (let a = 1; a <= 10; a++)
    for (let b = a; b <= 10; b++)
      for (let c = b; c <= 10; c++) {
        const hard = a + b + c;
        const hasAce = a === 1;
        if (hard !== h.total || (hasAce && hard + 10 <= 21)) continue;
        out.push([a as PointRank, b as PointRank, c as PointRank]);
      }
  return out;
}

/** Probability (up to a constant) of being dealt this multiset plus the upcard from `rem`. */
function compositionWeight(rem: Float64Array | Int32Array, cards: readonly PointRank[], up: PointRank): number {
  const c = Float64Array.from(rem);
  let w = 1;
  let n = c.reduce((a, b) => a + b, 0);
  for (const r of [up, ...cards]) {
    if (c[r] <= 0) return 0;
    w *= c[r] / n;
    c[r]--;
    n--;
  }
  // Orderings of the hand's multiset (the upcard position is fixed).
  const counts = new Map<number, number>();
  for (const r of cards) counts.set(r, (counts.get(r) ?? 0) + 1);
  let perms = factorial(cards.length);
  for (const k of counts.values()) perms /= factorial(k);
  return w * perms;
}

function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

function actionsEVs(cell: DeviationCell, rem: Int32Array, cards: readonly PointRank[], up: PointRank, h17: boolean): Partial<Record<McAction, number>> {
  const c = Int32Array.from(rem);
  c[up]--;
  if (cell.kind === "insurance") {
    // The hole card is drawn from the cards left after the upcard and the player's hand.
    for (const r of cards) c[r]--;
    const n = c.reduce((a, b) => a + b, 0);
    return { insure: (3 * c[10]) / n - 1, decline: 0 };
  }
  const a = new UpcardAnalyzer(c, up, h17);
  const e = a.handEVs(cards);
  const out: Partial<Record<McAction, number>> = { stand: e.stand, hit: e.hit, surrender: -0.5 };
  if (cards.length === 2) out.double = e.double;
  if (cell.hand!.kind === "pair") {
    const r = cards[0];
    const cs = Int32Array.from(c);
    cs[r]--;
    const sp = new UpcardAnalyzer(cs, up, h17).splitEVs(r);
    out.splitDAS = sp.splitDAS;
    out.splitNoDAS = sp.splitNoDAS;
  }
  return out;
}

/** Run one validation job. Pure and reproducible for a given seed. */
export function runMcJob(job: McJob, onProgress?: (done: number) => void): { records: McRecord[]; draws: number; states: number } {
  const rng: Rng = seededRng(job.seed);
  const total = 52 * job.decks;
  const cut = Math.round(total * job.penetration);
  const full = fullShoeCounts(job.decks);
  const comps = cellCompositions(job.cell, job.threeCard);
  const up = job.cell.up;
  const [lo, hi] = job.window;
  const filled = new Map<number, number>();
  const records: McRecord[] = [];
  const deck: number[] = [];
  for (let r = 1; r <= 10; r++) for (let k = 0; k < full[r]; k++) deck.push(r);

  let draws = 0;
  let states = 0;
  const target = (hi - lo + 1) * job.quotaPerBucket;
  let accepted = 0;
  while (accepted < target && draws < job.maxDraws) {
    draws++;
    // Partial Fisher–Yates: only the first k positions are needed.
    const k = Math.floor(rng() * (cut - 3));
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    const rem = Int32Array.from(full);
    let rc = 0;
    for (let i = 0; i < k; i++) {
      rem[deck[i]]--;
      rc += TAG[deck[i]];
    }
    // Screen on the first composition's bucket (cheap) before any EV work.
    const visible = (cards: readonly PointRank[]) => rc + TAG[up] + cards.reduce((n, r) => n + TAG[r], 0);
    // Cards still in the shoe: remaining minus the hand, the upcard and the face-down hole card.
    const inShoe = total - k - comps[0].length - 2;
    const dq = quarterDecks(inShoe);
    const screen = roundTrueCount(visible(comps[0]) / dq, "floor");
    if (screen < lo || screen > hi || (filled.get(screen) ?? 0) >= job.quotaPerBucket) continue;
    filled.set(screen, (filled.get(screen) ?? 0) + 1);
    accepted++;
    const s = states++;
    for (const cards of comps) {
      const w = compositionWeight(rem, cards, up);
      if (w === 0) continue;
      const raw = visible(cards) / dq;
      records.push({
        s,
        depth: k / total,
        w,
        tcRaw: raw,
        bucket: { floor: roundTrueCount(raw, "floor"), truncate: roundTrueCount(raw, "truncate"), nearest: roundTrueCount(raw, "nearest") },
        ev: actionsEVs(job.cell, rem, cards, up, job.h17),
      });
    }
    if (onProgress && s % 100 === 0) onProgress(accepted);
  }
  return { records, draws, states };
}

// ---------------------------------------------------------------------------
// Analysis

export interface BucketStat {
  readonly tc: number;
  readonly states: number;
  /** Mean EV per action (probability-weighted). */
  readonly ev: Readonly<Partial<Record<McAction, number>>>;
  readonly best: McAction;
  readonly runnerUp: McAction | null;
  /** best − runner-up, and its clustered standard error. */
  readonly margin: number;
  readonly se: number;
  /** margin > 2·se with at least 30 states. */
  readonly resolved: boolean;
}

export function bucketStats(records: readonly McRecord[], convention: McConvention, actions: readonly McAction[]): BucketStat[] {
  const byBucket = new Map<number, McRecord[]>();
  for (const r of records) {
    const b = r.bucket[convention];
    (byBucket.get(b) ?? byBucket.set(b, []).get(b)!).push(r);
  }
  const out: BucketStat[] = [];
  for (const [tc, rs] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
    const W = rs.reduce((n, r) => n + r.w, 0);
    const ev: Partial<Record<McAction, number>> = {};
    for (const a of actions) ev[a] = rs.reduce((n, r) => n + r.w * (r.ev[a] ?? -Infinity), 0) / W;
    const ranked = [...actions].sort((a, b) => ev[b]! - ev[a]!);
    const best = ranked[0];
    const runnerUp = ranked[1] ?? null;
    const states = new Set(rs.map((r) => r.s)).size;
    let margin = 0;
    let se = Infinity;
    if (runnerUp) {
      margin = ev[best]! - ev[runnerUp]!;
      // Cluster by state: X_s = Σ w·(ev_best − ev_ru), W_s = Σ w.
      const cl = new Map<number, { x: number; w: number }>();
      for (const r of rs) {
        const c = cl.get(r.s) ?? { x: 0, w: 0 };
        c.x += r.w * (r.ev[best]! - r.ev[runnerUp]!);
        c.w += r.w;
        cl.set(r.s, c);
      }
      const n = cl.size;
      let ss = 0;
      for (const c of cl.values()) ss += (c.x - margin * c.w) ** 2;
      se = n > 1 ? Math.sqrt((ss / (W * W)) * (n / (n - 1))) : Infinity;
    }
    out.push({ tc, states, ev, best, runnerUp, margin, se, resolved: states >= 30 && margin > 2 * se });
  }
  return out;
}

export type McVerdict = "validated" | "no-deviation" | "unresolved" | "non-monotone";

export interface McIndexResult {
  readonly verdict: McVerdict;
  /** Best action per integer true count over the tested window. */
  readonly bucketActions: readonly { tc: number; action: McAction; resolved: boolean }[];
  /** True counts where the best action changes (first bucket of the new action). */
  readonly transitions: readonly { from: McAction; to: McAction; at: number; uncertain: boolean }[];
  readonly note: string;
}

/**
 * Derive the index from bucket statistics. A transition is accepted when the
 * last resolved bucket of the old action and the first resolved bucket of the
 * new one are at most two counts apart (the bucket between them sits on the
 * crossing, where both plays are worth almost the same). Wider gaps leave the
 * index unresolved.
 */
export function deriveIndex(stats: readonly BucketStat[]): McIndexResult {
  const bucketActions = stats.map((b) => ({ tc: b.tc, action: b.best, resolved: b.resolved }));
  const resolved = stats.filter((b) => b.resolved);
  if (resolved.length < 2) return { verdict: "unresolved", bucketActions, transitions: [], note: "Too few resolved true-count buckets." };
  const transitions: { from: McAction; to: McAction; at: number; uncertain: boolean }[] = [];
  const seen = new Set<McAction>([resolved[0].best]);
  for (let i = 1; i < resolved.length; i++) {
    const a = resolved[i - 1];
    const b = resolved[i];
    if (a.best === b.best) continue;
    if (seen.has(b.best)) return { verdict: "non-monotone", bucketActions, transitions, note: `The best play returns to ${b.best} at TC ${b.tc}.` };
    seen.add(b.best);
    if (b.tc - a.tc > 2) return { verdict: "unresolved", bucketActions, transitions, note: `Crossing between TC ${a.tc} and ${b.tc} is not resolved.` };
    // First bucket (by point estimate) favouring the new action after the last resolved old one.
    const between = stats.filter((s) => s.tc > a.tc && s.tc <= b.tc);
    const first = between.find((s) => s.best === b.best) ?? b;
    transitions.push({ from: a.best, to: b.best, at: first.tc, uncertain: first.tc !== b.tc || b.tc - a.tc > 1 });
  }
  if (!transitions.length) return { verdict: "no-deviation", bucketActions, transitions, note: `The same play is best at every resolved true count tested (${resolved[0].best}).` };
  return { verdict: "validated", bucketActions, transitions, note: "" };
}

export function jobSeed(...parts: (string | number | boolean)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export { seededRng };
