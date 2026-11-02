import { describe, expect, it } from "vitest";
import { buildCards, stackedShoe } from "@/lib/blackjack/shoe";
import type { PointRank, Rank } from "@/lib/blackjack/cards";
import { runningCount, trueCount } from "@/lib/blackjack/counting";
import { basicStrategyAction, withShoe, type GameState } from "@/lib/blackjack/engine";
import { fullShoeCounts, UpcardAnalyzer } from "@/lib/blackjack/analysis/ca";
import { cellCurves, combineDepths, bandsFromCurve, allowedActions, compositionAtTrueCount, pairThreshold } from "@/lib/blackjack/analysis/index-gen";
import { CELL_BY_ID, DEVIATION_CELLS } from "@/lib/blackjack/deviations/definitions";
import { toDeviationAction } from "@/lib/blackjack/deviations/validation";
import {
  bucketRepresentative,
  cellUnavailableReason,
  cellValidation,
  mcPlayAt,
  entryFor,
  evaluateDeviation,
  integerIndex,
  matchCell,
  resolveIndexSet,
  type IndexSet,
} from "@/lib/blackjack/deviations/registry";
import { seededRng } from "@/lib/blackjack/rng";
import { DEFAULT_RULES, type TableRules } from "@/lib/blackjack/rules";
import { filterCells, generateDeviationScenario, gradeDeviationAnswer } from "@/lib/training/deviation-trainer";
import { DEFAULT_CHECKPOINTS } from "@/lib/training/table/count-checks";
import { DEFAULT_INTERMEDIATE } from "@/lib/training/table/modes";
import {
  createTrainingTable,
  skipCheck,
  submitCheck,
  trainingAct,
  trainingDeal,
  trainingInsurance,
  withSession,
  type TrainingOptions,
  type TrainingTable,
} from "@/lib/training/table/training-table";
import { aggregateHistory } from "@/lib/training/table/history";
import { gradeTableDecision, deviationForState } from "@/lib/training/table/decisions";

type P = PointRank;

// ---------------------------------------------------------------------------
// 1. Mathematical audit against published Wizard of Odds tables

describe("EV audit vs published composition-dependent tables (Wizard of Odds, Appendix 9)", () => {
  // [cards, upcard, stand, hit, double] — dealer peeks, values conditional on no dealer blackjack.
  const twoDeckH17: [P[], P, number, number, number][] = [
    [[10, 6], 10, -0.541889, -0.523992, -1.047984],
    [[9, 7], 10, -0.529433, -0.526286, -1.052572],
    [[6, 5], 1, -0.587564, 0.121079, 0.16665],
    [[10, 2], 4, -0.206125, -0.204205, -0.408411],
    [[7, 1], 9, -0.18137, -0.093889, -0.2734],
    [[5, 4], 2, -0.27676, 0.082575, 0.086204],
    [[10, 10], 6, 0.673275, -0.850096, -1.700192],
  ];
  const sixDeckS17: [P[], P, number, number, number][] = [
    [[10, 6], 10, -0.540954, -0.534676, -1.069351],
    [[6, 5], 1, -0.661883, 0.147596, 0.12971],
    [[10, 2], 3, -0.254531, -0.231352, -0.462705],
    [[6, 4], 10, -0.542043, 0.026796, -0.005603],
    [[6, 4], 1, -0.662192, 0.081336, -0.004174],
    [[7, 1], 2, 0.124001, 0.063289, 0.12098],
  ];
  it.each([
    ["2 decks H17", 2, true, twoDeckH17],
    ["6 decks S17", 6, false, sixDeckS17],
  ] as const)("%s: stand, hit and double EVs match to published precision", (_, decks, h17, rows) => {
    for (const [cards, up, s, h, d] of rows) {
      const comp = fullShoeCounts(decks);
      comp[up]--;
      const e = new UpcardAnalyzer(comp, up, h17).handEVs(cards);
      expect(e.stand).toBeCloseTo(s, 6);
      expect(e.hit).toBeCloseTo(h, 6);
      expect(e.double).toBeCloseTo(d, 6);
    }
  });

  it("split EV without resplitting sits slightly below the published resplit-to-4 value (8,8 v 10)", () => {
    const c = fullShoeCounts(6);
    c[10]--;
    c[8]--;
    const sp = new UpcardAnalyzer(c, 10, false).splitEVs(8);
    // Published: DAS −0.475385, no DAS −0.486276 (resplitting allowed).
    expect(sp.splitDAS).toBeLessThan(-0.475385);
    expect(sp.splitDAS).toBeGreaterThan(-0.475385 - 0.012);
    expect(sp.splitNoDAS).toBeLessThan(-0.486276);
    expect(sp.splitNoDAS).toBeGreaterThan(-0.486276 - 0.012);
  });

  it("10,10 split EV equals the single-split formula (the published column forces resplits)", () => {
    // EV(split) = 2 × Σ_r P(r) · best(10, r), computed independently from two-card hand EVs.
    const decks = 6;
    const up = 6 as P;
    const comp = fullShoeCounts(decks);
    comp[up]--;
    comp[10] -= 2;
    let ev = 0;
    const n = comp.reduce((a, b) => a + b, 0);
    for (let r = 1; r <= 10; r++) {
      const p = comp[r] / n;
      const c = Int32Array.from(comp);
      c[10]++; // the hand's own ten is drawn from this composition by handEVs
      const e = new UpcardAnalyzer(c, up, false).handEVs([10, r as P]);
      ev += p * Math.max(e.stand, r === 1 ? e.stand : e.hit, e.double);
    }
    const c2 = fullShoeCounts(decks);
    c2[up]--;
    c2[10]--;
    const sp = new UpcardAnalyzer(c2, up, false).splitEVs(10);
    // Hole-card weighting differs slightly from this unconditioned average.
    expect(sp.splitDAS).toBeCloseTo(2 * ev, 2);
    expect(sp.splitDAS).toBeGreaterThan(0.444942); // published forced-resplit value
  });

  it("split aces receive exactly one card each", () => {
    const c = fullShoeCounts(2);
    c[6]--;
    c[1]--;
    const a = new UpcardAnalyzer(c, 6, true);
    const sp = a.splitEVs(1);
    const n = c.reduce((x, y) => x + y, 0) - 1; // one ace in the hand
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      const cnt = c[r] - (r === 1 ? 1 : 0);
      const cc = Int32Array.from(c);
      const e = new UpcardAnalyzer(cc, 6, true).handEVs([1, r as P]);
      ev += (cnt / n) * e.stand;
    }
    expect(sp.splitDAS).toBe(sp.splitNoDAS);
    expect(sp.splitDAS).toBeCloseTo(2 * ev, 2);
  });

  it("fractional compositions with whole-number counts reproduce integer results exactly", () => {
    const i = fullShoeCounts(2);
    i[10]--;
    const f = Float64Array.from(i);
    expect(new UpcardAnalyzer(f, 10, true).handEVs([10, 6])).toEqual(new UpcardAnalyzer(i, 10, true).handEVs([10, 6]));
  });

  it("the true-count composition model keeps D decks and shifts the Hi-Lo groups by RC/2", () => {
    const c = compositionAtTrueCount(2, 3);
    const total = c.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(104, 9);
    const low = c[2] + c[3] + c[4] + c[5] + c[6];
    const high = c[10] + c[1];
    expect(high - low).toBeCloseTo(6, 9); // remaining high − low = RC = TC × D
  });
});

// ---------------------------------------------------------------------------
// 2. Index registry

function set(rules: Partial<TableRules>, convention: Parameters<typeof resolveIndexSet>[1] = "floor"): IndexSet {
  const r = resolveIndexSet({ ...DEFAULT_RULES, ...rules }, convention);
  if (!r.supported) throw new Error(r.reason);
  return r.set;
}

describe("index registry", () => {
  it("validates the generator against the published six-deck Illustrious 18 and Fab 4", () => {
    const s6 = set({ decks: 6, dealerHitsSoft17: false, doubleAfterSplit: true, surrender: "late" });
    const misses: string[] = [];
    for (const cell of DEVIATION_CELLS) {
      const entry = entryFor(s6, cell.id)!;
      cell.published.forEach((p, k) => {
        const ts = entry.pairs[k].depthThresholds;
        expect(ts.every((t) => t !== null), `${cell.id} ${p.above}`).toBe(true);
        const computed = Math.round((ts[0]! + ts[1]!) / 2);
        if (Math.abs(computed - p.index) > 1) misses.push(`${cell.id}:${p.above} computed ${computed} vs published ${p.index}`);
      });
    }
    // After the Phase 7.1 visible-card fix every published value is reproduced within ±1.
    expect(misses).toEqual([]);
    const t16 = entryFor(s6, "h16v10")!.pairs[0].depthThresholds;
    expect(Math.round((t16[0]! + t16[1]!) / 2) + 0).toBe(0);
  });

  it("selects sets by decks, soft-17, DAS and surrender, and refuses unsupported rules", () => {
    const r = resolveIndexSet({ ...DEFAULT_RULES }, "truncate");
    expect(r.supported && r.id).toBe("hilo-v1:2D-H17-DAS-NS-truncate");
    const one = resolveIndexSet({ ...DEFAULT_RULES, decks: 1 }, "floor");
    expect(one.supported).toBe(false);
    expect(!one.supported && one.reason).toMatch(/Single-deck/);
    // Six-deck values are not reused for double deck: these sets differ.
    const two = set({ decks: 2, dealerHitsSoft17: false });
    const six = set({ decks: 6, dealerHitsSoft17: false });
    expect(entryFor(two, "p10v6")!.bands).not.toEqual(entryFor(six, "p10v6")!.bands);
  });

  it("disables plays the rules don't allow", () => {
    const s = set({ decks: 6, dealerHitsSoft17: false, surrender: "none" });
    expect(cellUnavailableReason(s, CELL_BY_ID.get("h15v9")!, { ...DEFAULT_RULES, decks: 6, surrender: "none" }, "floor")).toMatch(/surrender/);
    const ls = set({ decks: 6, dealerHitsSoft17: false, surrender: "late" });
    expect(cellUnavailableReason(ls, CELL_BY_ID.get("h15v9")!, { ...DEFAULT_RULES, decks: 6, surrender: "late" }, "floor")).toBeNull();
    expect(cellUnavailableReason(s, CELL_BY_ID.get("h9v2")!, { ...DEFAULT_RULES, decks: 6, doubleRestriction: "10-11" }, "floor")).toMatch(/Doubling 9/);
    expect(cellUnavailableReason(s, CELL_BY_ID.get("insurance")!, { ...DEFAULT_RULES, decks: 6, insurance: false }, "floor")).toMatch(/Insurance/);
  });

  it("maps crossings to integer indices per true-count convention", () => {
    expect(integerIndex(2.3, "floor")).toBe(2);
    expect(integerIndex(2.6, "floor")).toBe(3);
    expect(integerIndex(-1.4, "floor")).toBe(-1);
    expect(integerIndex(-1.4, "truncate")).toBe(0);
    expect(integerIndex(-1.6, "truncate")).toBe(-1);
    expect(integerIndex(-1.4, "nearest")).toBe(-1);
    expect(bucketRepresentative(0, "truncate")).toBe(0);
    expect(bucketRepresentative(-2, "truncate")).toBe(-2.5);
  });

  it("applies every validated index exactly at its transition, under every convention", () => {
    let checked = 0;
    for (const conv of ["floor", "truncate", "nearest"] as const) {
      for (const rules of [{ ...DEFAULT_RULES }, { ...DEFAULT_RULES, dealerHitsSoft17: false, surrender: "late" as const }]) {
        const s = set(rules, conv);
        for (const cell of DEVIATION_CELLS) {
          if (cellUnavailableReason(s, cell, rules, conv)) continue;
          const v = cellValidation(s, cell.id, conv);
          for (const t of v.result!.transitions) {
            const at = (tc: number) => mcPlayAt(v.result!, tc);
            const here = at(t.at);
            const below = at(t.at - 1);
            if (!t.uncertain) {
              expect(here.action, `${cell.id} ${conv} @${t.at}`).toBe(toDeviationAction(t.to));
              expect(below.action).toBe(toDeviationAction(t.from));
            } else {
              // An unresolved crossing bucket accepts both plays.
              expect([here.action, here.alternative]).toContain(toDeviationAction(t.to));
            }
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("never grades an unvalidated index", () => {
    const four = set({ decks: 4 }, "floor");
    const cellX = CELL_BY_ID.get("h12v3")!;
    expect(cellValidation(four, "h12v3", "floor").status).toBe("experimental");
    expect(cellUnavailableReason(four, cellX, { ...DEFAULT_RULES, decks: 4 }, "floor")).toMatch(/Experimental/);
    expect(() =>
      evaluateDeviation(four, "floor", { cell: cellX, runningCount: 10, decksEstimate: 2, deckTolerance: 0, legal: ["hit", "stand"], basic: "hit" }),
    ).toThrow(/not validated/);
  });

  it("uses the nearest resolved bucket beyond the tested range and accepts both plays only on a crossing", () => {
    const r = {
      verdict: "validated" as const,
      note: "",
      transitions: [{ from: "hit" as const, to: "stand" as const, at: 2, uncertain: true }],
      buckets: [
        { tc: 0, n: 200, best: "hit" as const, runnerUp: "stand" as const, margin: 0.01, se: 0.002, resolved: true },
        { tc: 1, n: 200, best: "hit" as const, runnerUp: "stand" as const, margin: 0.001, se: 0.002, resolved: false },
        { tc: 2, n: 200, best: "stand" as const, runnerUp: "hit" as const, margin: 0.001, se: 0.002, resolved: false },
        { tc: 3, n: 200, best: "stand" as const, runnerUp: "hit" as const, margin: 0.01, se: 0.002, resolved: true },
        { tc: 8, n: 3, best: "hit" as const, runnerUp: "stand" as const, margin: 0.001, se: 0.05, resolved: false },
      ],
    };
    expect(mcPlayAt(r, -5)).toEqual({ action: "hit", alternative: null });
    expect(mcPlayAt(r, 1)).toEqual({ action: "hit", alternative: "stand" });
    expect(mcPlayAt(r, 2)).toEqual({ action: "stand", alternative: "hit" });
    expect(mcPlayAt(r, 3)).toEqual({ action: "stand", alternative: null });
    // A thin, noisy edge bucket does not override the resolved trend.
    expect(mcPlayAt(r, 8)).toEqual({ action: "stand", alternative: null });
    expect(mcPlayAt(r, 14)).toEqual({ action: "stand", alternative: null });
  });

  it("looks up exact true counts with floor buckets and handles negative counts per convention", () => {
    const s = set({}, "exact");
    const cellX = DEVIATION_CELLS.find((c) => !cellUnavailableReason(s, c, DEFAULT_RULES, "exact"))!;
    const v = cellValidation(s, cellX.id, "floor").result!;
    // −1.4 exact → floor bucket −2 (raw ≥ −2 but < −1).
    const e = evaluateDeviation(s, "exact", { cell: cellX, runningCount: -7, decksEstimate: 5, deckTolerance: 0, legal: cellX.actions, basic: cellX.actions[0] });
    expect(e.trueCount).toBe(-1.4);
    expect(e.countAction).toBe(mcPlayAt(v, -2).action);
    expect(trueCount(-7, 5, "truncate")).toBe(-1);
    expect(trueCount(-7, 5, "floor")).toBe(-2);
    expect(trueCount(-7, 5, "nearest")).toBe(-1);
  });

  it("only matches two-card, unsplit hands", () => {
    expect(matchCell({ cards: ["10", "6"], up: "10", fromSplit: false })?.id).toBe("h16v10");
    expect(matchCell({ cards: ["5", "5", "6"], up: "10", fromSplit: false })).toBeNull();
    expect(matchCell({ cards: ["10", "6"], up: "10", fromSplit: true })).toBeNull();
    expect(matchCell({ cards: ["8", "8"], up: "10", fromSplit: false })).toBeNull();
    expect(matchCell({ cards: ["K", "10"], up: "6", fromSplit: false })?.id).toBe("p10v6");
    expect(matchCell({ cards: ["A", "5"], up: "10", fromSplit: false })).toBeNull();
  });

  it("committed index data is reproducible for a sample cell", () => {
    const cell = CELL_BY_ID.get("h12v6")!;
    const curves = cellCurves(cell, 2, true, true);
    const fresh = combineDepths(cell.id, curves.depths.map((d) => bandsFromCurve(d.evs, allowedActions(cell, false))));
    const saved = entryFor(set({}), "h12v6")!;
    expect(fresh.bands).toEqual(saved.bands);
    expect(saved.pairs[0].depthThresholds).toEqual(curves.depths.map((d) => pairThreshold(d.evs, "stand", "hit")));
  }, 60000);
});

// ---------------------------------------------------------------------------
// 3. Deviation Trainer

describe("deviation trainer scenarios", () => {
  const rules = { ...DEFAULT_RULES, decks: 6 as const, dealerHitsSoft17: false, surrender: "late" as const };
  const s = set(rules, "truncate");

  it("are real shoe states with consistent running and true counts, on both sides of the index", () => {
    const rng = seededRng(5);
    const cells = filterCells(s, rules, "all", "truncate");
    const sides = new Map<string, Set<boolean>>();
    for (let i = 0; i < 300; i++) {
      const sc = generateDeviationScenario(s, rules, "truncate", cells, rng)!;
      const all = [...sc.discards, ...sc.player, sc.dealerUp];
      expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
      expect(sc.runningCount).toBe(runningCount(all));
      // Cards in the shoe exclude the dealt-but-unseen hole card, as at the table.
      expect(52 * rules.decks - all.length - 1).toBe(Math.round(52 * sc.decksRemaining));
      expect(sc.trueCount).toBe(trueCount(sc.runningCount, sc.decksRemaining, "truncate"));
      expect(Math.abs(sc.trueCount)).toBeLessThanOrEqual(8);
      (sides.get(sc.cell.id) ?? sides.set(sc.cell.id, new Set()).get(sc.cell.id)!).add(sc.evaluation.deviates);
      expect(gradeDeviationAnswer(sc, sc.evaluation.countAction).correct).toBe(true);
    }
    // Most cells were seen both with and without the deviation due.
    const both = [...sides.values()].filter((x) => x.size === 2).length;
    expect(both).toBeGreaterThan(sides.size * 0.6);
  });

  it("filters positive, negative, valuable and missed plays", () => {
    const pos = filterCells(s, rules, "positive", "truncate").map((c) => c.id);
    const neg = filterCells(s, rules, "negative", "truncate").map((c) => c.id);
    expect(pos).toContain("h12v2");
    expect(neg).toContain("h13v3");
    expect(pos.some((id) => neg.includes(id))).toBe(false);
    expect(filterCells(s, rules, "valuable", "truncate").map((c) => c.id)).toContain("insurance");
    expect(filterCells(s, rules, "missed", "truncate", ["h9v7"]).map((c) => c.id)).toEqual(["h9v7"]);
    expect(filterCells(s, rules, { cellId: "p10v5" }, "truncate").map((c) => c.id)).toEqual(["p10v5"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Table integration

const OPTS: TrainingOptions = {
  mode: "beginner",
  intermediate: DEFAULT_INTERMEDIATE,
  checkpoints: { ...DEFAULT_CHECKPOINTS, every: 0, endOfShoe: true },
  rounding: "truncate",
  keepDecisionDetail: true,
  deviations: true,
};

/** A table whose shoe has `discards` already dealt (and counted), then `top` cards. */
function tableAt(discards: Rank[], top: Rank[], rules: Partial<TableRules> = {}, opts = OPTS): TrainingTable {
  const r = seededRng(1);
  const fullRules = { ...DEFAULT_RULES, aiPlayers: 0, ...rules };
  const t = createTrainingTable({ rules: fullRules, humanSeat: 0, bankroll: 10_000 }, opts, r, 1);
  const shoe = stackedShoe(fullRules.decks, [...discards, ...top], r, fullRules.penetration);
  const seen = shoe.cards.slice(0, discards.length);
  const state: GameState = {
    ...withShoe(t.session.state, { ...shoe, position: discards.length }),
    count: { runningCount: runningCount(seen), cardsSeen: seen.length, valid: true },
  };
  return withSession(t, { ...t.session, state });
}

const LOW20: Rank[] = ["2", "3", "4", "5", "6", "2", "3", "4", "5", "6", "2", "3", "4", "5", "6", "2", "3", "4", "5", "6"];

describe("deviations at the table", () => {
  it("a correct index play is a successful deviation, not a basic-strategy mistake", () => {
    // RC +20 before the hand; P 10, up 3, P 2, hole 9: 12 v 3 at a very high count → stand.
    let t = tableAt(LOW20, ["10", "3", "2", "9", "K"]);
    t = trainingDeal(t, 10, OPTS, seededRng(2), 1);
    t = trainingAct(t, "stand", OPTS, seededRng(2), 1);
    const d = t.lastDecision!;
    expect(d.correct).toBe(false); // differs from basic strategy…
    expect(d.countCorrect).toBe(true); // …but correct count-adjusted
    expect(d.deviation).toMatchObject({ cellId: "h12v3", outcome: "followed", deviates: true, countAction: "stand", basic: "hit" });
    expect(d.evLoss).toBeNull();
  });

  it("records a missed deviation and a wrong deviation", () => {
    let missed = tableAt(LOW20, ["10", "3", "2", "9", "K"]);
    missed = trainingAct(trainingDeal(missed, 10, OPTS, seededRng(2), 1), "hit", OPTS, seededRng(2), 1);
    expect(missed.lastDecision!.deviation!.outcome).toBe("missed");
    expect(missed.lastDecision!.countCorrect).toBe(false);

    let wrong = tableAt([], ["10", "3", "2", "9", "K"]); // count ≈ 0
    wrong = trainingAct(trainingDeal(wrong, 10, OPTS, seededRng(2), 1), "stand", OPTS, seededRng(2), 1);
    expect(wrong.lastDecision!.deviation).toMatchObject({ outcome: "wrong-deviation", deviates: false });
    expect(wrong.lastDecision!.countCorrect).toBe(false);
  });

  it("grades from visible information only: the hole card and undealt order do not matter", () => {
    const a = trainingDeal(tableAt(LOW20, ["10", "3", "2", "9", "K", "5"]), 10, OPTS, seededRng(2), 1);
    const b = trainingDeal(tableAt(LOW20, ["10", "3", "2", "K", "9", "A"]), 10, OPTS, seededRng(3), 1);
    const ctx = { resolution: resolveIndexSet(a.session.state.rules, "truncate"), convention: "truncate" as const };
    const hand = { cards: ["10", "2"] as Rank[], up: "3" as Rank, fromSplit: false };
    const ea = deviationForState(a.session.state, ctx, hand, ["hit", "stand", "double"], "hit");
    const eb = deviationForState(b.session.state, ctx, hand, ["hit", "stand", "double"], "hit");
    expect(ea).toEqual(eb);
    // Changing only the hole card's Hi-Lo value would change the count if it leaked.
    expect(runningCount([{ rank: "9" }])).not.toBe(runningCount([{ rank: "K" }]));
  });

  it("does not grade deviations on split hands", () => {
    let t = tableAt(LOW20, ["10", "5", "10", "7", "2", "3", "K", "K"]);
    t = trainingDeal(t, 10, OPTS, seededRng(2), 1);
    t = trainingAct(t, "split", OPTS, seededRng(2), 1);
    expect(t.tracker.decisions[0].deviation?.cellId).toBe("p10v5");
    t = trainingAct(t, "stand", OPTS, seededRng(2), 1); // 10,2 after split v 5
    expect(t.tracker.decisions[1].deviation).toBeNull();
  });

  it("grades insurance against the insurance index and records its result separately", () => {
    // High count: take insurance (followed). P 10, up A, P 9, hole 7 (no blackjack).
    let hi = tableAt(LOW20, ["10", "A", "9", "7"]);
    hi = trainingDeal(hi, 20, OPTS, seededRng(2), 1);
    expect(hi.session.state.phase).toBe("insurance");
    hi = trainingInsurance(hi, 10, OPTS, seededRng(2), 1);
    expect(hi.lastInsurance).toMatchObject({ chosen: "insure", countCorrect: true, deviation: { outcome: "followed" } });
    expect(hi.tracker.insurance[0].net).toBe(-10);

    let lo = tableAt([], ["10", "A", "9", "K"]);
    lo = trainingInsurance(trainingDeal(lo, 20, OPTS, seededRng(2), 1), 10, OPTS, seededRng(2), 1);
    expect(lo.lastInsurance).toMatchObject({ chosen: "insure", countCorrect: false, deviation: { outcome: "wrong-deviation" } });
    expect(lo.tracker.insurance[0].net).toBe(20);
  });

  it("end-of-shoe reports separate deviations, basic mistakes and insurance across many hands", () => {
    const r = seededRng(77);
    let t = createTrainingTable({ rules: { ...DEFAULT_RULES, aiPlayers: 3 }, humanSeat: 2, bankroll: 100_000 }, OPTS, r, 1);
    for (let guard = 0; guard < 300 && !t.completedReport; guard++) {
      if (t.pending) {
        t = t.pending.kind === "end-of-shoe" ? submitCheck(t, { runningCount: 0 }, OPTS, 2) : skipCheck(t, OPTS, 2);
        continue;
      }
      t = trainingDeal(t, 10, OPTS, r, 2);
      if (t.session.state.phase === "insurance") t = trainingInsurance(t, 0, OPTS, r, 2);
      // Play basic strategy every time, so every deviation opportunity is a miss.
      while (t.session.state.phase === "playerTurn" && !t.pending) t = trainingAct(t, basicStrategyAction(t.session.state), OPTS, r, 2);
    }
    const rep = t.completedReport!;
    const dv = rep.deviations!;
    expect(rep.strategy.grading).toBe("count-adjusted");
    expect(dv.indexSetId).toBe("hilo-v1:2D-H17-DAS-NS-truncate");
    expect(dv.followed).toBe(0);
    expect(dv.wrongDeviations).toBe(0);
    expect(dv.missed).toBeLessThanOrEqual(dv.opportunities);
    const byCellDecisions = dv.byCell.reduce((n, c) => n + c.decisions, 0);
    const graded = rep.decisions!.filter((d) => d.deviation).length + (rep.insurance?.offered ?? 0);
    expect(byCellDecisions).toBe(graded);
    expect(rep.strategy.basicMatches).toBe(rep.strategy.graded);
    // Play mistakes are the missed play deviations; insurance misses are reported with insurance.
    const playMisses = rep.decisions!.filter((d) => d.deviation?.outcome === "missed").length;
    expect(rep.strategy.incorrect).toBe(playMisses);
    const insuranceMisses = dv.byCell.find((c) => c.cellId === "insurance")?.missed ?? 0;
    expect(playMisses + insuranceMisses).toBe(dv.missed);
    if (rep.insurance) expect(rep.insurance.correct).toBe(rep.insurance.offered - insuranceMisses);
    // EV lost covers only basic-strategy mistakes, of which there are none.
    expect(rep.strategy.estimatedEvLost).toBe(0);
    if (rep.insurance) expect(rep.insurance.taken).toBe(0);
    const agg = aggregateHistory([rep]);
    expect(agg.deviationOpportunities).toBe(dv.opportunities);
  });

  it("an unsupported ruleset turns deviation grading off and explains why", () => {
    let t = tableAt([], ["10", "3", "2", "9", "K"], { decks: 1, maxSplitHands: 2 });
    t = trainingAct(trainingDeal(t, 10, OPTS, seededRng(2), 1), "stand", OPTS, seededRng(2), 1);
    expect(t.lastDecision!.deviation).toBeNull();
    expect(t.lastDecision!.countCorrect).toBe(t.lastDecision!.correct);
    expect("unavailable" in t.tracker.deviationSet && t.tracker.deviationSet.unavailable).toMatch(/Single-deck/);
  });

  it("table and trainer evaluate the same situation identically", () => {
    const rules = { ...DEFAULT_RULES };
    const s = set(rules, "truncate");
    let t = tableAt(LOW20, ["10", "3", "2", "9", "K"]);
    t = trainingDeal(t, 10, OPTS, seededRng(2), 1);
    const state = t.session.state;
    const table = gradeTableDecision(state, "stand", { resolution: resolveIndexSet(rules, "truncate"), convention: "truncate" }).deviation!;
    const direct = evaluateDeviation(s, "truncate", {
      cell: CELL_BY_ID.get("h12v3")!,
      runningCount: 21,
      decksEstimate: 1.5,
      deckTolerance: 0.25,
      legal: ["hit", "stand", "double"],
      basic: "hit",
    });
    expect(table.countAction).toBe(direct.countAction);
    expect(table.trueCount).toBe(direct.trueCount);
    expect(table.acceptable).toEqual(direct.acceptable);
  });
});

void buildCards;
