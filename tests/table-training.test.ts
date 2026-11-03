import { afterEach, describe, expect, it } from "vitest";
import type { Rank } from "@/lib/blackjack/cards";
import { runningCount, trueCount } from "@/lib/blackjack/counting";
import { basicStrategyAction, withShoe } from "@/lib/blackjack/engine";
import { seededRng, type Rng } from "@/lib/blackjack/rng";
import { DEFAULT_RULES, type TableRules } from "@/lib/blackjack/rules";
import { stackedShoe } from "@/lib/blackjack/shoe";
import { buildTableView } from "@/lib/blackjack/table-view";
import { createPersistentStore } from "@/lib/storage/persistent-store";
import { DEFAULT_SETTINGS, parseSettings } from "@/lib/storage/stores";
import { actualFromView, DEFAULT_CHECKPOINTS, gradeCheckpoint, shouldCheckpoint, type CheckpointActual } from "@/lib/training/table/count-checks";
import { addReport, aggregateHistory, emptyShoeHistory, MAX_DETAILED_REPORTS, MAX_REPORTS, parseShoeHistory } from "@/lib/training/table/history";
import { assistanceFor, DEFAULT_INTERMEDIATE } from "@/lib/training/table/modes";
import type { ShoeReport } from "@/lib/training/table/shoe-tracker";
import {
  canRequestCheck,
  createTrainingTable,
  requestCheck,
  skipCheck,
  submitCheck,
  trainingAct,
  trainingDeal,
  trainingInsurance,
  withSession,
  type TrainingOptions,
  type TrainingTable,
} from "@/lib/training/table/training-table";

const OPTS: TrainingOptions = {
  mode: "beginner",
  intermediate: DEFAULT_INTERMEDIATE,
  checkpoints: { ...DEFAULT_CHECKPOINTS, every: 0 },
  rounding: "truncate",
  keepDecisionDetail: true,
  // Phase 6 tests grade against basic strategy; deviation tests opt in.
  deviations: false,
};

function table(o: { rules?: Partial<TableRules>; top?: Rank[]; humanSeat?: number; opts?: TrainingOptions; rng?: Rng } = {}): TrainingTable {
  const r = o.rng ?? seededRng(3);
  const rules = { ...DEFAULT_RULES, aiPlayers: 0, ...o.rules };
  const t = createTrainingTable({ rules, humanSeat: o.humanSeat ?? 0, bankroll: 100_000 }, o.opts ?? OPTS, r, 1000);
  if (!o.top) return t;
  return withSession(t, { ...t.session, state: withShoe(t.session.state, stackedShoe(rules.decks, o.top, r, rules.penetration)) });
}

/** Play to the end of the current shoe; answer checkpoints correctly (test oracle) unless told to skip. */
function playShoe(t: TrainingTable, r: Rng, opts: TrainingOptions, answer: "correct" | "skip" | "off-by-one" = "correct"): TrainingTable {
  for (let guard = 0; guard < 500; guard++) {
    if (t.pending) {
      if (answer === "skip") t = skipCheck(t, opts, 2000);
      else {
        const a = actualFromView(buildTableView(t.session.state), opts.rounding);
        const delta = answer === "off-by-one" ? 1 : 0;
        t = submitCheck(t, { runningCount: a.runningCount + delta, trueCount: a.trueCount, decks: a.decksQuarter }, opts, 2000);
      }
      if (t.completedReport) return t;
      continue;
    }
    t = trainingDeal(t, 10, opts, r, 2000);
    if (t.session.state.phase === "insurance") t = trainingInsurance(t, 0, opts, r, 2000);
    while (t.session.state.phase === "playerTurn" && !t.pending) t = trainingAct(t, basicStrategyAction(t.session.state), opts, r, 2000);
    if (t.completedReport) return t;
  }
  throw new Error("shoe did not end");
}

describe("count accuracy through complete shoes", () => {
  it.each([
    ["double deck, 3 AI players", { decks: 2 as const, aiPlayers: 3 }],
    ["six deck, 5 AI players", { decks: 6 as const, aiPlayers: 5, penetration: 0.75 }],
  ])("%s: snapshots and final count match the dealt cards exactly", (_, rules) => {
    const r = seededRng(21);
    let t = table({ rules, humanSeat: 1, rng: r });
    const shoeCards = t.session.state.shoe.cards;
    t = playShoe(t, r, OPTS);
    const report = t.completedReport!;
    expect(report.termination).toBe("cut-card");
    expect(report.completedNormally).toBe(true);
    for (const p of report.progression) expect(p.runningCount).toBe(runningCount(shoeCards.slice(0, p.cardsDealt)));
    expect(report.counting.finalActual).toBe(runningCount(shoeCards.slice(0, report.shoe.cardsDealt)));
    expect(report.shoe.cardsDealt).toBeGreaterThanOrEqual(Math.round(shoeCards.length * ((rules as Partial<TableRules>).penetration ?? 0.7)));
    expect(report.counting.finalSubmitted).toBe(report.counting.finalActual);
    const tcs = report.progression.slice(1).map((p) => p.trueCount);
    expect(report.shoe.maxTrueCount).toBe(Math.max(...tcs));
    expect(report.shoe.minTrueCount).toBe(Math.min(...tcs));
    expect(report.shoe.rounds).toBe(report.progression.length - 1);
  });
});

describe("count checks", () => {
  it("a check during the player's turn excludes the unrevealed hole card", () => {
    // P 2, up 5, P 3, hole K (−1, hidden).
    let t = table({ top: ["2", "5", "3", "K", "9"] });
    t = trainingDeal(t, 10, OPTS, seededRng(1), 1);
    expect(canRequestCheck(t, OPTS)).toBe(true);
    t = requestCheck(t, OPTS);
    expect(() => trainingAct(t, "stand", OPTS, seededRng(1), 1)).toThrow(); // play is paused
    t = submitCheck(t, { runningCount: 3, trueCount: null }, OPTS, 1);
    const cp = t.lastCheckpoint!;
    expect(cp.atBoundary).toBe(false);
    expect(cp.actual.runningCount).toBe(3); // 2, 5, 3 → +3; the K is not counted yet
    expect(cp.grade.rcCorrect).toBe(true);
    t = trainingAct(t, "stand", OPTS, seededRng(1), 1);
    expect(buildTableView(t.session.state).count.runningCount).toBe(2); // K revealed
  });

  it("grades running count, true count (with rounding), deck estimate and arithmetic separately", () => {
    const actual: CheckpointActual = {
      runningCount: -5,
      cardsRemaining: 78,
      decksRemaining: 1.5,
      decksQuarter: 1.5,
      trueCount: trueCount(-5, 1.5, "truncate"),
      trueCountRaw: -5 / 1.5,
      cardsDealt: 26,
      valid: true,
    };
    const opts = { rounding: "truncate" as const, askTrueCount: true, askDecks: true, decks: 2 };
    const g = gradeCheckpoint(actual, { runningCount: -5, trueCount: -3, decks: 1.5 }, opts);
    expect(g).toMatchObject({ rcCorrect: true, rcError: 0, tcCorrect: true, tcError: 0, deckCorrect: true, arithmeticCorrect: true });
    // Floor rounding makes −3.33 → −4.
    const floor = gradeCheckpoint({ ...actual, trueCount: trueCount(-5, 1.5, "floor") }, { runningCount: -5, trueCount: -3 }, { ...opts, rounding: "floor" });
    expect(floor.tcCorrect).toBe(false);
    expect(floor.tcError).toBe(1);
    // Wrong deck estimate, consistent arithmetic: −5 / 2.5 = −2.
    const g2 = gradeCheckpoint(actual, { runningCount: -5, trueCount: -2, decks: 2.5 }, opts);
    expect(g2).toMatchObject({ deckCorrect: false, deckError: 1, arithmeticCorrect: true, tcCorrect: false });
    // Two-deck tolerance is a quarter deck.
    expect(gradeCheckpoint(actual, { runningCount: -5, decks: 1.75 }, opts).deckCorrect).toBe(true);
    expect(gradeCheckpoint(actual, { runningCount: -5, decks: 2 }, opts).deckCorrect).toBe(false);
    // Unanswered is never correct.
    const skipped = gradeCheckpoint(actual, { runningCount: null }, opts);
    expect(skipped).toMatchObject({ answered: false, rcCorrect: false, rcError: null, tcCorrect: false, deckCorrect: false });
  });

  it("decks remaining use undealt cards (including those behind the cut card)", () => {
    let t = table({ rules: { decks: 2 }, top: ["10", "6", "9", "7"] });
    t = trainingDeal(t, 10, OPTS, seededRng(2), 1);
    t = trainingAct(t, "stand", OPTS, seededRng(2), 1);
    const v = buildTableView(t.session.state);
    const a = actualFromView(v, "truncate");
    expect(a.cardsRemaining).toBe(104 - t.session.state.shoe.position);
    expect(a.decksRemaining).toBeCloseTo(a.cardsRemaining / 52, 9);
  });

  it("schedules automatic checks every N rounds or at random ≈1 in N", () => {
    const fixed = { ...DEFAULT_CHECKPOINTS, every: 3, random: false };
    expect([1, 2, 3, 4].map((n) => shouldCheckpoint(fixed, n, Math.random))).toEqual([false, false, true, true]);
    expect(shouldCheckpoint({ ...fixed, every: 0 }, 99, Math.random)).toBe(false);
    const r = seededRng(4);
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (shouldCheckpoint({ ...fixed, random: true, every: 4 }, 1, r)) hits++;
    expect(hits / 20000).toBeGreaterThan(0.23);
    expect(hits / 20000).toBeLessThan(0.27);
  });

  it("automatic checks pause between rounds and block dealing until answered", () => {
    const opts = { ...OPTS, checkpoints: { ...DEFAULT_CHECKPOINTS, every: 1, random: false } };
    const r = seededRng(8);
    let t = table({ rules: { aiPlayers: 2 }, opts, rng: r });
    t = trainingDeal(t, 10, opts, r, 1);
    while (t.session.state.phase === "playerTurn") t = trainingAct(t, basicStrategyAction(t.session.state), opts, r, 1);
    expect(t.pending).toEqual({ kind: "checkpoint", trigger: "scheduled", atBoundary: true });
    expect(() => trainingDeal(t, 10, opts, r, 1)).toThrow();
    t = skipCheck(t, opts, 1);
    expect(t.pending).toBeNull();
    expect(t.tracker.checkpoints[0].grade.answered).toBe(false);
  });
});

describe("strategy decision logging", () => {
  it("logs split and post-split doubles as approximate, executes wrong plays unchanged, and sums EV loss", () => {
    // You 8,8 vs 6 (hole 10). Hand 1 draws 3 (11) and doubles onto K; hand 2 draws 2 (10). Then dealer draws.
    let t = table({ top: ["8", "6", "8", "10", "3", "K", "2", "K", "K"] });
    const r = seededRng(5);
    t = trainingDeal(t, 10, OPTS, r, 1);
    t = trainingAct(t, "split", OPTS, r, 1);
    t = trainingAct(t, "double", OPTS, r, 1); // 11 v 6: correct
    t = trainingAct(t, "stand", OPTS, r, 1); // 10 v 6: wrong (should double)
    const [split, dbl, stand] = t.tracker.decisions;
    expect(split).toMatchObject({ chosen: "split", correct: true, quality: "approximate", cards: ["8", "8"], upcard: "6" });
    expect(split.notes.join(" ")).toMatch(/without resplitting/);
    expect(dbl).toMatchObject({ chosen: "double", best: "double", correct: true, quality: "approximate" });
    expect(stand).toMatchObject({ chosen: "stand", best: "double", correct: false });
    expect(stand.evLoss!).toBeGreaterThan(0);
    expect(stand.available).toContain("double");
    // The mistake was executed as chosen.
    expect(t.session.state.seats[0].hands[1].cards).toHaveLength(2);

    const r2 = seededRng(6);
    t = playShoe(t, r2, OPTS);
    const s = t.completedReport!.strategy;
    const logged = t.completedReport!.decisions!;
    expect(s.estimatedEvLost).toBeCloseTo(logged.reduce((n, d) => n + (d.evLoss ?? 0), 0), 12);
    expect(s.incorrect).toBeGreaterThanOrEqual(1);
    expect(s.topMisses[0]).toMatchObject({ key: "hard 10|6", best: "double", chosen: "stand" });
    expect(s.correct + s.incorrect).toBe(s.graded);
  });

  it("two-card starting hands are graded from the table; split aces that may be hit are left ungraded", () => {
    let t = table({ top: ["10", "6", "6", "10", "K"] });
    t = trainingDeal(t, 10, OPTS, seededRng(1), 1);
    t = trainingAct(t, "hit", OPTS, seededRng(1), 1);
    expect(t.lastDecision).toMatchObject({ quality: "table", correct: false, best: "stand" });

    let a = table({ rules: { hitSplitAces: true }, top: ["A", "6", "A", "10", "5", "7"] });
    a = trainingDeal(a, 10, OPTS, seededRng(1), 1);
    a = trainingAct(a, "split", OPTS, seededRng(1), 1);
    a = trainingAct(a, "hit", OPTS, seededRng(1), 1);
    expect(a.lastDecision).toMatchObject({ quality: "ungraded", correct: null, evLoss: null });
  });

  it("dealer blackjack ends the round with no decisions and counts the revealed hole card", () => {
    let t = table({ top: ["9", "A", "9", "K"] });
    t = trainingDeal(t, 10, OPTS, seededRng(1), 1);
    t = trainingInsurance(t, 0, OPTS, seededRng(1), 1);
    expect(t.tracker.decisions).toHaveLength(0);
    expect(t.tracker.snapshots.at(-1)!.runningCount).toBe(-2); // 9, A, 9, K
  });
});

describe("end-of-shoe report", () => {
  it("skipped checks are recorded as unanswered, never as correct", () => {
    const r = seededRng(30);
    const opts = { ...OPTS, checkpoints: { ...DEFAULT_CHECKPOINTS, every: 4, random: false } };
    const t = playShoe(table({ rules: { aiPlayers: 2 }, opts, rng: r }), r, opts, "skip");
    const c = t.completedReport!.counting;
    expect(c.checkpoints).toBeGreaterThan(1);
    expect(c.answered).toBe(0);
    expect(c.correct).toBe(0);
    expect(c.finalSubmitted).toBeNull();
    expect(c.avgAbsRcError).toBeNull();
  });

  it("reports average errors and plots only measured estimates", () => {
    const r = seededRng(31);
    const opts = { ...OPTS, checkpoints: { ...DEFAULT_CHECKPOINTS, every: 3, random: false } };
    const t = playShoe(table({ rules: { aiPlayers: 1 }, opts, rng: r }), r, opts, "off-by-one");
    const rep = t.completedReport!;
    expect(rep.counting.correct).toBe(0);
    expect(rep.counting.avgAbsRcError).toBe(1);
    expect(rep.estimates).toHaveLength(rep.counting.checkpoints);
    for (const e of rep.estimates) expect(e.estimatedRc).toBe(e.actualRc + 1);
    expect(rep.estimates.at(-1)!.trigger).toBe("end-of-shoe");
  });

  it("the next shoe gets a fresh tracker aligned with the engine's shoe number", () => {
    const r = seededRng(32);
    let t = playShoe(table({ rules: { aiPlayers: 2 }, rng: r }), r, OPTS);
    const first = t.completedReport!;
    expect(t.tracker.shoeNumber).toBe(2);
    expect(t.tracker.rounds).toBe(0);
    t = trainingDeal(t, 10, OPTS, r, 3000);
    expect(t.session.state.shoeNumber).toBe(2);
    expect(t.session.state.log[0]).toEqual({ type: "shuffle", reason: "cut-card" });
    expect(t.completedReport).toBeNull();
    expect(first.id).not.toBe(t.tracker.startedAt.toString(36) + "-2");
  });

  it("an interrupted (count-invalid) shoe is reported as excluded from counting metrics", () => {
    const r = seededRng(9);
    let t = table({ rules: { decks: 1 }, rng: r });
    const stacked = stackedShoe(1, ["A", "2", "A", "2", "A", "A", "2", "2"], r);
    const cards = [...stacked.cards.slice(8), ...stacked.cards.slice(0, 8)];
    t = withSession(t, { ...t.session, state: { ...t.session.state, shoe: { decks: 1, cards, position: 44, cutCardIndex: 52 } } });
    t = trainingDeal(t, 10, OPTS, r, 1);
    while (t.session.state.phase === "playerTurn") t = trainingAct(t, "hit", OPTS, r, 1);
    const rep = t.completedReport!;
    expect(rep.termination).toBe("exhausted");
    expect(rep.completedNormally).toBe(false);
    expect(rep.counting.valid).toBe(false);
    expect(rep.counting.invalidReason).toMatch(/excluded/);
    expect(t.pending).toBeNull(); // no meaningless final-count question
    const agg = aggregateHistory([rep]);
    expect(agg.validShoes).toBe(0);
    expect(agg.excludedShoes).toBe(1);
    expect(agg.checkpoints).toBe(0);
  });
});

describe("live count follows card revelation", () => {
  it("at every animation step, the shown count equals the Hi-Lo count of face-up cards only", () => {
    const r = seededRng(50);
    let t = table({ rules: { aiPlayers: 3 }, humanSeat: 2, rng: r });
    for (let round = 0; round < 25; round++) {
      if (t.pending) t = skipCheck(t, OPTS, 1);
      if (t.completedReport) break;
      t = trainingDeal(t, 10, OPTS, r, 1);
      while (t.session.state.phase === "playerTurn" && !t.pending) t = trainingAct(t, basicStrategyAction(t.session.state), OPTS, r, 1);
      const st = t.session.state;
      const start = st.roundStart.count.runningCount;
      for (let k = 0; k <= st.log.length; k++) {
        const v = buildTableView(st, k);
        const faceUp = [...v.dealer.cards, ...v.seats.flatMap((seat) => seat.hands.flatMap((h) => h.cards))].filter(
          (c): c is Extract<typeof c, { faceDown: false }> => !c.faceDown,
        );
        expect(actualFromView(v, "truncate").runningCount).toBe(start + runningCount(faceUp));
      }
    }
  });
});

describe("training modes", () => {
  it("records every mode used during a shoe, including mid-round switches", () => {
    let t = table({ top: ["10", "6", "6", "10", "K"] });
    t = trainingDeal(t, 10, OPTS, seededRng(1), 1);
    const inter = { ...OPTS, mode: "intermediate" as const };
    t = requestCheck(t, inter);
    t = submitCheck(t, { runningCount: 0 }, inter, 1);
    const casino = { ...OPTS, mode: "casino" as const };
    t = trainingAct(t, "stand", casino, seededRng(1), 1);
    expect(t.tracker.modes).toEqual(["beginner", "intermediate", "casino"]);
  });

  it("Casino Mode shows no count, no hints, and defers all feedback", () => {
    const a = assistanceFor("casino", { hints: true, immediateFeedback: true });
    expect(a).toEqual({
      liveCount: false,
      strategyHint: false,
      decisionFeedback: "deferred",
      checkpointFeedback: "deferred",
      manualChecks: false,
      betHint: false,
      betFeedback: "deferred",
    });
    expect(assistanceFor("beginner", DEFAULT_INTERMEDIATE)).toMatchObject({ liveCount: true, strategyHint: true, decisionFeedback: "immediate" });
    expect(assistanceFor("intermediate", { hints: false, immediateFeedback: false })).toMatchObject({
      liveCount: false,
      strategyHint: false,
      decisionFeedback: "deferred",
      checkpointFeedback: "immediate",
    });
  });

  it("Casino Mode refuses manual checks but always asks the final count", () => {
    const casino: TrainingOptions = { ...OPTS, mode: "casino", checkpoints: { ...DEFAULT_CHECKPOINTS, every: 0, endOfShoe: false } };
    const r = seededRng(40);
    let t = table({ rules: { aiPlayers: 1 }, opts: casino, rng: r });
    expect(canRequestCheck(t, casino)).toBe(false);
    expect(() => requestCheck(t, casino)).toThrow();
    for (let i = 0; i < 200 && !t.pending; i++) {
      t = trainingDeal(t, 10, casino, r, 1);
      if (t.session.state.phase === "insurance") t = trainingInsurance(t, 0, casino, r, 1);
      while (t.session.state.phase === "playerTurn") t = trainingAct(t, basicStrategyAction(t.session.state), casino, r, 1);
    }
    expect(t.pending).toMatchObject({ kind: "end-of-shoe", termination: "cut-card" });
    expect(t.tracker.checkpoints).toHaveLength(0);
  });
});

describe("persistence", () => {
  const original = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = original;
  });

  function sampleReport(id: string, withDetail = true): ShoeReport {
    const r = seededRng(id.length * 7);
    const t = playShoe(table({ rules: { aiPlayers: 1 }, rng: r }), r, OPTS);
    const rep = { ...t.completedReport!, id };
    return withDetail ? rep : (({ decisions: _d, ...rest }) => (void _d, rest))(rep);
  }

  it("parses versioned history and drops malformed entries", () => {
    expect(parseShoeHistory(null)).toBeNull();
    expect(parseShoeHistory({ version: 3, reports: [] })).toBeNull();
    const good = sampleReport("a");
    const parsed = parseShoeHistory({ version: 1, reports: [good, { id: "x" }, 42, null] });
    expect(parsed!.reports.map((r) => r.id)).toEqual(["a"]);
    expect(parseShoeHistory({ version: 1 })!.reports).toEqual([]);
  });

  it("migrates Phase 6 (version 1) history and reports without losing data", () => {
    const v2 = sampleReport("old", false);
    // Reconstruct what Phase 6 saved: version 1 reports without deviation/insurance fields.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deviations: _d, deviationsNote: _n, insurance: _i, ...rest } = v2;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { grading: _g, basicMatches: _b, ...strategy } = v2.strategy;
    const v1 = { ...rest, version: 1, strategy };
    const h = parseShoeHistory(JSON.parse(JSON.stringify({ version: 1, reports: [v1] })))!;
    expect(h.version).toBe(2);
    const r = h.reports[0];
    expect(r.version).toBe(2);
    expect(r.deviations).toBeNull();
    expect(r.deviationsNote).toMatch(/before deviation grading/);
    expect(r.strategy.grading).toBe("basic");
    expect(r.strategy.basicMatches).toBe(v2.strategy.correct);
    expect(r.counting).toEqual(v2.counting);
    expect(aggregateHistory([r]).decisions).toBe(v2.strategy.graded);
  });

  it("caps history size, keeps decision detail only for recent shoes, and ignores duplicates", () => {
    const base = sampleReport("base");
    let h = emptyShoeHistory();
    for (let i = 0; i < MAX_REPORTS + 15; i++) h = addReport(h, { ...base, id: `r${i}` });
    expect(h.reports).toHaveLength(MAX_REPORTS);
    expect(h.reports[0].id).toBe("r15");
    expect(h.reports.filter((r) => r.decisions).length).toBe(MAX_DETAILED_REPORTS);
    expect(addReport(h, { ...base, id: "r100" })).toBe(h);
  });

  it("round-trips through localStorage and survives corrupt saved data", () => {
    const mem = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) },
      addEventListener() {},
      removeEventListener() {},
    };
    const report = sampleReport("persist");
    const store = createPersistentStore("test.shoes", emptyShoeHistory(), parseShoeHistory);
    store.set((h) => addReport(h, report));
    const reloaded = createPersistentStore("test.shoes", emptyShoeHistory(), parseShoeHistory);
    expect(reloaded.get().reports[0]).toEqual(report);

    mem.set("test.bad", "{not json");
    expect(createPersistentStore("test.bad", emptyShoeHistory(), parseShoeHistory).get()).toEqual(emptyShoeHistory());
  });

  it("settings saved before Phase 6 load with training defaults", () => {
    const old = { ...DEFAULT_SETTINGS, sim: { animation: "fast", humanSeat: 0, startingBankroll: 500, lastBet: 25 } };
    const s = parseSettings(JSON.parse(JSON.stringify(old)))!;
    expect(s.sim.animation).toBe("fast");
    expect(s.sim.training).toEqual(DEFAULT_SETTINGS.sim.training);
  });
});
