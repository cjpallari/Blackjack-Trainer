import { describe, expect, it } from "vitest";
import { cellEVs, compositionAtTrueCount, depthsFor, TC_GRID } from "@/lib/blackjack/analysis/index-gen";
import { bucketStats, cellCompositions, deriveIndex, runMcJob, type BucketStat, type McRecord } from "@/lib/blackjack/analysis/mc-validate";
import { fullShoeCounts, UpcardAnalyzer } from "@/lib/blackjack/analysis/ca";
import { CELL_BY_ID } from "@/lib/blackjack/deviations/definitions";
import twoDeckH17 from "@/lib/blackjack/strategy-data/2D-H17.json";

const cell = (id: string) => CELL_BY_ID.get(id)!;

describe("Monte Carlo harness", () => {
  it("is reproducible for a seed", () => {
    const job = { decks: 2, h17: true, penetration: 0.7, cell: cell("h16v10"), window: [-1, 1] as [number, number], quotaPerBucket: 20, maxDraws: 100000, seed: 9 };
    expect(runMcJob(job).records).toEqual(runMcJob(job).records);
    expect(runMcJob({ ...job, seed: 10 }).records).not.toEqual(runMcJob(job).records);
  });

  it("with nothing dealt, reproduces the off-the-top basic-strategy table exactly", () => {
    const r = runMcJob({ decks: 2, h17: true, penetration: 3.5 / 104, cell: cell("h9v2"), window: [-9, 9], quotaPerBucket: 1, maxDraws: 1, seed: 1 });
    const W = r.records.reduce((n, x) => n + x.w, 0);
    const mean = (a: "hit" | "double") => r.records.reduce((n, x) => n + x.w * x.ev[a]!, 0) / W;
    expect(r.records.every((x) => x.depth === 0)).toBe(true);
    expect(mean("hit")).toBeCloseTo(twoDeckH17.hard["9"]["2"].hit, 6);
    expect(mean("double")).toBeCloseTo(twoDeckH17.hard["9"]["2"].double, 6);
  });

  it("buckets by the observable true count: visible cards counted, the hole card not", () => {
    const r = runMcJob({ decks: 2, h17: true, penetration: 0.7, cell: cell("h12v3"), window: [-3, 3], quotaPerBucket: 10, maxDraws: 100000, seed: 4 });
    for (const x of r.records.slice(0, 40)) {
      // Undealt cards = 104 − dealt − hand (2) − upcard − hole; deck estimate to a quarter deck.
      const inShoe = 104 - Math.round(x.depth * 104) - 4;
      const dq = Math.max(0.25, Math.round((inShoe / 52) * 4) / 4);
      expect(x.bucket.floor).toBe(Math.floor(x.tcRaw + 1e-9));
      expect(Math.abs(x.tcRaw * dq - Math.round(x.tcRaw * dq))).toBeLessThan(1e-9); // RC is an integer
    }
  });

  it("insurance EV uses the cards left after the upcard and the player's hand", () => {
    const r = runMcJob({ decks: 2, h17: true, penetration: 3.5 / 104, cell: cell("insurance"), window: [-9, 9], quotaPerBucket: 1, maxDraws: 1, seed: 1 });
    const tenTen = r.records.find((x) => x.ev.insure !== undefined && cellCompositions(cell("insurance")).length > 0 && x.w > 0)!;
    expect(tenTen.ev.decline).toBe(0);
    // Off the top with A up: tens are 32/103 minus the player's tens; insurance is −EV.
    expect(tenTen.ev.insure!).toBeLessThan(0);
  });

  it("enumerates hard three-card totals without soft hands", () => {
    const comps = cellCompositions(cell("h16v10"), true);
    expect(comps.every((c) => c.reduce((a, b) => a + b, 0) === 16 && c.length === 3)).toBe(true);
    expect(comps.some((c) => c.includes(1))).toBe(true); // e.g. A,5,10 is a hard 16
    expect(comps.some((c) => c.join() === "1,5,10")).toBe(true);
    expect(comps.some((c) => c.join() === "1,2,3")).toBe(false);
  });
});

describe("index derivation from buckets", () => {
  const b = (tc: number, best: "hit" | "stand", resolved: boolean): BucketStat => ({
    tc,
    states: 100,
    ev: {},
    best,
    runnerUp: best === "hit" ? "stand" : "hit",
    margin: resolved ? 0.01 : 0.001,
    se: 0.002,
    resolved,
  });

  it("accepts a crossing with at most one unresolved bucket between resolved sides", () => {
    const r = deriveIndex([b(-1, "hit", true), b(0, "hit", true), b(1, "stand", false), b(2, "stand", true)]);
    expect(r.verdict).toBe("validated");
    expect(r.transitions).toEqual([{ from: "hit", to: "stand", at: 1, uncertain: true }]);
    const clean = deriveIndex([b(0, "hit", true), b(1, "stand", true)]);
    expect(clean.transitions[0]).toMatchObject({ at: 1, uncertain: false });
  });

  it("leaves wide unresolved gaps unresolved and flags non-monotone results", () => {
    expect(deriveIndex([b(-1, "hit", true), b(0, "hit", false), b(1, "stand", false), b(2, "stand", false), b(3, "stand", true)]).verdict).toBe("unresolved");
    expect(deriveIndex([b(0, "hit", true), b(1, "stand", true), b(2, "hit", true)]).verdict).toBe("non-monotone");
    expect(deriveIndex([b(0, "hit", true), b(1, "hit", true)]).verdict).toBe("no-deviation");
  });

  it("computes clustered standard errors that shrink with samples", () => {
    const mk = (n: number): McRecord[] =>
      Array.from({ length: n }, (_, s) => ({ s, depth: 0.3, w: 1, tcRaw: 1, bucket: { floor: 1, truncate: 1, nearest: 1 }, ev: { hit: 0.01 * Math.sin(s), stand: 0.005 } }));
    const small = bucketStats(mk(50), "floor", ["hit", "stand"])[0];
    const large = bucketStats(mk(800), "floor", ["hit", "stand"])[0];
    expect(large.se).toBeLessThan(small.se);
    expect(large.best).toBe("stand");
  });
});

describe("synthetic generator corrections", () => {
  it("synthetic compositions stay within the finite shoe for every tested true count and depth", () => {
    for (const decks of [2, 4, 6, 8]) {
      const full = fullShoeCounts(decks);
      for (const d of depthsFor(decks))
        for (const t of TC_GRID) {
          const c = compositionAtTrueCount(d, t);
          for (let r = 1; r <= 10; r++) {
            expect(c[r]).toBeGreaterThanOrEqual(0);
            expect(c[r]).toBeLessThanOrEqual(full[r]);
          }
        }
    }
  });

  it("evaluates each hand on the unseen cards plus its own visible cards (regression)", () => {
    // The 10,10 v 6 stand EV must be computed on the unseen cards plus the two visible tens.
    const comp = compositionAtTrueCount(1.25, 2);
    const withTens = Float64Array.from(comp);
    withTens[10] += 2;
    const direct = new UpcardAnalyzer(withTens, 6, true).handEVs([10, 10]);
    const ev = cellEVs(cell("p10v6"), comp, true, true);
    expect(ev.stand).toBe(direct.stand);
    // The old (buggy) construction removed the visible tens from the model shoe instead.
    const old = Float64Array.from(comp);
    old[6] -= 1;
    expect(new UpcardAnalyzer(old, 6, true).handEVs([10, 10]).stand).not.toBe(ev.stand);
    // Insurance: hole card drawn from the unseen cards, so p(ten) = tens / unseen.
    const ins = cellEVs(cell("insurance"), comp, true, true);
    expect(ins.insure).toBeCloseTo((3 * comp[10]) / comp.reduce((a, b) => a + b, 0) - 1, 12);
  });
});
