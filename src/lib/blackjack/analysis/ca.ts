/**
 * Exact finite-shoe combinatorial analysis of blackjack decisions.
 *
 * Model:
 * - Cards are point ranks 1..10 (1 = Ace, 10 = any ten-value).
 * - US hole card with dealer peek: with an Ace or Ten up the dealer is known
 *   not to hold a natural. The hole card is modelled explicitly: every EV is a
 *   vector indexed by hole card, and the player's decisions at each node use
 *   the posterior hole-card weights given the cards seen so far. This is exact
 *   for the peek condition rather than the common "condition only the dealer"
 *   approximation.
 * - Card removal: the player's cards, the upcard and the hole card are all
 *   removed from the shoe when computing draw probabilities.
 * - Splits are approximated without resplitting: EV(split) = 2 × EV of one
 *   hand that starts with the split card, drawn from a shoe with both split
 *   cards removed. Split aces receive one card.
 *
 * All EVs are per unit initial bet, conditional on the dealer not having a
 * natural (which is the information the player has when acting).
 */

import type { PointRank } from "../cards";

const KEY_BASE = 22;
const POW: number[] = [0];
for (let r = 1; r <= 10; r++) POW[r] = KEY_BASE ** (r - 1);

/** Dealer final-hand distribution: indices 0..4 = 17..21, 5 = bust. */
type DealerDist = Float64Array;
/** EV vector indexed by hole card rank 1..10 (index 0 unused). */
type HoleVec = Float64Array;

const BUST_DIST: DealerDist = Float64Array.from([0, 0, 0, 0, 0, 1]);
const STAND_DISTS: DealerDist[] = [17, 18, 19, 20, 21].map((t) => {
  const d = new Float64Array(6);
  d[t - 17] = 1;
  return d;
});

export interface AnalysisRules {
  readonly decks: number;
  readonly dealerHitsSoft17: boolean;
}

export interface HandEVs {
  stand: number;
  hit: number;
  double: number;
}

export interface SplitEVs {
  splitDAS: number;
  splitNoDAS: number;
}

export function fullShoeCounts(decks: number): Int32Array {
  const c = new Int32Array(11);
  for (let r = 1; r <= 9; r++) c[r] = 4 * decks;
  c[10] = 16 * decks;
  return c;
}

/**
 * Analyses player hands against one dealer upcard from a fixed composition.
 * Mutable internal state is used for speed; the public methods restore it.
 */
export class UpcardAnalyzer {
  private readonly rem: Int32Array;
  private remN: number;
  private readonly hand = new Int32Array(11);
  private handKey = 0;
  private handHard = 0;

  private readonly standMemo = new Map<number, HoleVec>();
  private readonly hitMemo = new Map<number, HoleVec>();
  private readonly bestMemo = new Map<number, HoleVec>();
  private readonly doubleMemo = new Map<number, HoleVec>();

  /**
   * @param composition cards remaining after removing the upcard (and any
   *   other known cards, e.g. the second split card).
   */
  constructor(
    composition: Int32Array,
    private readonly up: PointRank,
    private readonly h17: boolean,
  ) {
    this.rem = Int32Array.from(composition);
    this.remN = this.rem.reduce((a, b) => a + b, 0);
  }

  private holeAllowed(h: number): boolean {
    if (this.up === 1) return h !== 10;
    if (this.up === 10) return h !== 1;
    return true;
  }

  private addCard(r: number) {
    this.hand[r]++;
    this.handKey += POW[r];
    this.handHard += r;
    this.rem[r]--;
    this.remN--;
  }

  private removeCard(r: number) {
    this.hand[r]--;
    this.handKey -= POW[r];
    this.handHard -= r;
    this.rem[r]++;
    this.remN++;
  }

  private handTotal(): number {
    return this.hand[1] > 0 && this.handHard + 10 <= 21 ? this.handHard + 10 : this.handHard;
  }

  /** Posterior hole-card probabilities given the current composition. */
  private weights(): Float64Array {
    const w = new Float64Array(11);
    let sum = 0;
    for (let h = 1; h <= 10; h++) {
      if (this.holeAllowed(h) && this.rem[h] > 0) {
        w[h] = this.rem[h];
        sum += this.rem[h];
      }
    }
    for (let h = 1; h <= 10; h++) w[h] /= sum;
    return w;
  }

  private dot(w: Float64Array, v: HoleVec): number {
    let s = 0;
    for (let h = 1; h <= 10; h++) if (w[h] > 0) s += w[h] * v[h];
    return s;
  }

  /** Dealer outcome distribution given a known hole card (already removed from `rem`). */
  private dealerDist(hole: number): DealerDist {
    const memo = new Map<number, DealerDist>();
    const rem = this.rem;
    const h17 = this.h17;
    const rec = (key: number, hard: number, ace: boolean, n: number): DealerDist => {
      const soft = ace && hard + 10 <= 21;
      const best = soft ? hard + 10 : hard;
      if (best > 21) return BUST_DIST;
      if (best >= 17 && !(best === 17 && soft && h17)) return STAND_DISTS[best - 17];
      const cached = memo.get(key);
      if (cached) return cached;
      const out = new Float64Array(6);
      for (let r = 1; r <= 10; r++) {
        const c = rem[r];
        if (c === 0) continue;
        const p = c / n;
        rem[r]--;
        const sub = rec(key + POW[r], hard + r, ace || r === 1, n - 1);
        rem[r]++;
        for (let i = 0; i < 6; i++) out[i] += p * sub[i];
      }
      memo.set(key, out);
      return out;
    };
    return rec(0, this.up + hole, this.up === 1 || hole === 1, this.remN);
  }

  private standVec(): HoleVec {
    const cached = this.standMemo.get(this.handKey);
    if (cached) return cached;
    const total = this.handTotal();
    const v = new Float64Array(11);
    for (let h = 1; h <= 10; h++) {
      if (!this.holeAllowed(h) || this.rem[h] === 0) continue;
      if (total > 21) {
        v[h] = -1;
        continue;
      }
      this.rem[h]--;
      this.remN--;
      const d = this.dealerDist(h);
      this.rem[h]++;
      this.remN++;
      let ev = d[5];
      for (let i = 0; i < 5; i++) {
        const dt = 17 + i;
        if (total > dt) ev += d[i];
        else if (total < dt) ev -= d[i];
      }
      v[h] = ev;
    }
    this.standMemo.set(this.handKey, v);
    return v;
  }

  /** Draw one card, then continue with `next` (or -1 on bust); scaled by `mult`. */
  private drawVec(next: () => HoleVec, mult: number): HoleVec {
    const acc = new Float64Array(11);
    const n = this.remN;
    for (let r = 1; r <= 10; r++) {
      const c = this.rem[r];
      if (c === 0) continue;
      this.addCard(r);
      const child = this.handTotal() > 21 ? null : next();
      this.removeCard(r);
      for (let h = 1; h <= 10; h++) {
        if (!this.holeAllowed(h) || this.rem[h] === 0) continue;
        const cr = r === h ? c - 1 : c;
        if (cr <= 0) continue;
        const p = cr / (n - 1);
        acc[h] += p * mult * (child ? child[h] : -1);
      }
    }
    return acc;
  }

  private hitVec(): HoleVec {
    const cached = this.hitMemo.get(this.handKey);
    if (cached) return cached;
    const v = this.drawVec(() => this.bestVec(), 1);
    this.hitMemo.set(this.handKey, v);
    return v;
  }

  /** Optimal play (hit or stand only) from the current hand. */
  private bestVec(): HoleVec {
    const cached = this.bestMemo.get(this.handKey);
    if (cached) return cached;
    let v: HoleVec;
    if (this.handTotal() >= 21) {
      v = this.standVec();
    } else {
      const s = this.standVec();
      const hv = this.hitVec();
      const w = this.weights();
      v = this.dot(w, s) >= this.dot(w, hv) ? s : hv;
    }
    this.bestMemo.set(this.handKey, v);
    return v;
  }

  private doubleVec(): HoleVec {
    const cached = this.doubleMemo.get(this.handKey);
    if (cached) return cached;
    const v = this.drawVec(() => this.standVec(), 2);
    this.doubleMemo.set(this.handKey, v);
    return v;
  }

  private withHand<T>(cards: readonly PointRank[], fn: () => T): T {
    for (const c of cards) this.addCard(c);
    try {
      return fn();
    } finally {
      for (const c of cards) this.removeCard(c);
    }
  }

  /** EVs of stand / hit / double for a starting hand (cards drawn from this composition). */
  handEVs(cards: readonly PointRank[]): HandEVs {
    return this.withHand(cards, () => {
      const w = this.weights();
      return {
        stand: this.dot(w, this.standVec()),
        hit: this.dot(w, this.handTotal() >= 21 ? this.standVec() : this.hitVec()),
        double: this.dot(w, this.doubleVec()),
      };
    });
  }

  /**
   * EV of splitting a pair of `x`. This analyzer's composition must already
   * exclude the *other* split card; this hand starts with one `x`.
   */
  splitEVs(x: PointRank): SplitEVs {
    return this.withHand([x], () => {
      const w = this.weights();
      if (x === 1) {
        const v = this.drawVec(() => this.standVec(), 2);
        const ev = this.dot(w, v);
        return { splitDAS: ev, splitNoDAS: ev };
      }
      const choose = (allowDouble: boolean) => (): HoleVec => {
        const wNode = this.weights();
        let best = this.bestVec();
        if (allowDouble) {
          const d = this.doubleVec();
          if (this.dot(wNode, d) > this.dot(wNode, best)) best = d;
        }
        return best;
      };
      return {
        splitDAS: this.dot(w, this.drawVec(choose(true), 2)),
        splitNoDAS: this.dot(w, this.drawVec(choose(false), 2)),
      };
    });
  }
}
