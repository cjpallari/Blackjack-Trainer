import { describe, expect, it } from "vitest";
import { pointRank } from "@/lib/blackjack/cards";
import { runningCount } from "@/lib/blackjack/counting";
import { isBlackjack, isPair, handValue } from "@/lib/blackjack/hand";
import { seededRng } from "@/lib/blackjack/rng";
import { DEFAULT_RULES } from "@/lib/blackjack/rules";
import { DEFAULT_BS_OPTIONS, generateScenario, gradeChoice } from "@/lib/training/basic-strategy";
import { createDrill, DEFAULT_RC_CONFIG, expectedCount } from "@/lib/training/running-count";
import { emptyStats, missedScenarios, recordBasicStrategy, recordRcDrill } from "@/lib/training/stats";
import { generateTCScenario, gradeCalculate, gradeEstimate } from "@/lib/training/true-count";

describe("basic strategy scenarios", () => {
  const rng = seededRng(11);

  it("never deals a player natural and respects category filters", () => {
    for (const mode of ["hard", "soft", "pairs"] as const) {
      for (let i = 0; i < 200; i++) {
        const s = generateScenario(DEFAULT_RULES, { ...DEFAULT_BS_OPTIONS, mode, skipTrivial: false }, rng);
        expect(isBlackjack(s.player)).toBe(false);
        const pair = isPair(s.player);
        const soft = handValue(s.player).soft;
        if (mode === "pairs") expect(pair).toBe(true);
        if (mode === "soft") expect(soft && !pair).toBe(true);
        if (mode === "hard") expect(!soft && !pair).toBe(true);
      }
    }
  });

  it("filters dealer upcards", () => {
    for (let i = 0; i < 200; i++) {
      const s = generateScenario(DEFAULT_RULES, { ...DEFAULT_BS_OPTIONS, upcards: "weak" }, rng);
      const up = pointRank(s.dealerUp.rank);
      expect(up >= 2 && up <= 6).toBe(true);
    }
  });

  it("offers split only on pairs and surrender only under late surrender", () => {
    const pair = generateScenario(DEFAULT_RULES, { ...DEFAULT_BS_OPTIONS, mode: "pairs" }, rng);
    expect(pair.available).toContain("split");
    const hard = generateScenario(DEFAULT_RULES, { ...DEFAULT_BS_OPTIONS, mode: "hard" }, rng);
    expect(hard.available).not.toContain("split");
    expect(hard.available).not.toContain("surrender");
    const ls = generateScenario({ ...DEFAULT_RULES, surrender: "late" }, DEFAULT_BS_OPTIONS, rng);
    expect(ls.available).toContain("surrender");
  });

  it("uses distinct physical cards from a real shoe", () => {
    for (let i = 0; i < 200; i++) {
      const s = generateScenario({ ...DEFAULT_RULES, decks: 1 }, DEFAULT_BS_OPTIONS, rng);
      const ids = [...s.player, s.dealerUp].map((c) => c.id);
      expect(new Set(ids).size).toBe(3);
    }
  });

  it("missed mode only serves missed scenarios", () => {
    const keys = ["hard 16|10", "soft 18|9"];
    for (let i = 0; i < 30; i++) {
      const s = generateScenario(DEFAULT_RULES, { ...DEFAULT_BS_OPTIONS, mode: "missed" }, rng, keys);
      expect(keys).toContain(s.key);
    }
  });

  it("grades choices against the acceptable set and records EV loss", () => {
    const s = generateScenario(DEFAULT_RULES, { ...DEFAULT_BS_OPTIONS, mode: "hard" }, rng);
    const right = gradeChoice(s, s.advice.best);
    expect(right.correct).toBe(true);
    expect(right.evLoss).toBe(0);
    const wrong = s.available.find((a) => !s.advice.acceptable.includes(a));
    if (wrong) {
      const g = gradeChoice(s, wrong);
      expect(g.correct).toBe(false);
      expect(g.evLoss).toBeGreaterThan(0);
    }
  });
});

describe("running count drills", () => {
  it("full-deck countdown ends at zero", () => {
    const d = createDrill({ ...DEFAULT_RC_CONFIG, type: "deck", hiddenCards: 0 }, seededRng(1));
    expect(d.groups).toHaveLength(52);
    expect(expectedCount(d)).toBe(0);
    const dd = createDrill({ ...DEFAULT_RC_CONFIG, type: "doubleDeck", hiddenCards: 0 }, seededRng(2));
    expect(dd.groups).toHaveLength(104);
    expect(new Set(dd.groups.flat().map((c) => c.id)).size).toBe(104);
    expect(expectedCount(dd)).toBe(0);
  });

  it("hidden cards make the countdown answer the negation of their count", () => {
    for (let seed = 0; seed < 20; seed++) {
      const d = createDrill({ ...DEFAULT_RC_CONFIG, type: "deck", hiddenCards: 3 }, seededRng(seed));
      expect(d.hidden).toHaveLength(3);
      expect(expectedCount(d)).toBe(-runningCount(d.hidden) + 0);
    }
  });

  it("sequences and groups are drawn without replacement", () => {
    const d = createDrill({ ...DEFAULT_RC_CONFIG, type: "simultaneous", decks: 1, groupSize: 4, sequenceLength: 40 }, seededRng(3));
    const ids = d.groups.flat().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(d.groups.every((g) => g.length === 4)).toBe(true);
    const seq = createDrill({ ...DEFAULT_RC_CONFIG, type: "sequence", sequenceLength: 15 }, seededRng(4));
    expect(seq.groups).toHaveLength(15);
    expect(expectedCount(seq, 5)).toBe(runningCount(seq.groups.slice(0, 5).flat()));
  });
});

describe("true count scenarios", () => {
  it("come from real shoe states with quarter-deck estimates", () => {
    const rng = seededRng(8);
    for (const decks of [1, 2, 4, 6, 8]) {
      for (let i = 0; i < 50; i++) {
        const s = generateTCScenario(decks, rng);
        expect(s.cardsDealt + s.cardsRemaining).toBe(52 * decks);
        expect(Math.abs(s.runningCount)).toBeLessThanOrEqual(Math.min(s.cardsDealt, 20 * decks));
        expect((s.decksRemainingQuarter * 4) % 1).toBe(0);
        expect(Math.abs(s.decksRemainingQuarter - s.cardsRemaining / 52)).toBeLessThanOrEqual(0.125 + 1e-9);
      }
    }
  });

  it("grades calculation and separates deck-estimation errors from arithmetic", () => {
    const s = { decks: 6, cardsDealt: 234, runningCount: 6, cardsRemaining: 78, decksRemainingQuarter: 1.5 };
    expect(gradeCalculate(s, 4, "truncate").tcCorrect).toBe(true);
    expect(gradeCalculate(s, 3, "truncate").tcCorrect).toBe(false);
    // User estimates 3 decks (wrong) but divides correctly: 6 / 3 = 2.
    const g = gradeEstimate(s, 3, 2, "truncate");
    expect(g.deckCorrect).toBe(false);
    expect(g.calculationCorrect).toBe(true);
    expect(g.tcCorrect).toBe(false);
    // Correct estimate, wrong arithmetic.
    const g2 = gradeEstimate(s, 1.5, 3, "truncate");
    expect(g2.deckCorrect).toBe(true);
    expect(g2.calculationCorrect).toBe(false);
  });
});

describe("stats", () => {
  it("tracks streaks, categories and missed scenarios", () => {
    let s = emptyStats();
    const base = { at: Date.now(), category: "hard" as const, chosen: "hit" as const, ms: 1000, evLoss: 0 };
    s = recordBasicStrategy(s, { ...base, key: "hard 16|10", correct: true });
    s = recordBasicStrategy(s, { ...base, key: "hard 16|10", correct: true });
    expect(s.bs.streak).toBe(2);
    s = recordBasicStrategy(s, { ...base, key: "hard 12|3", correct: false, evLoss: 0.02 });
    expect(s.bs.streak).toBe(0);
    expect(s.bs.bestStreak).toBe(2);
    expect(s.bs.byCategory.hard).toEqual({ attempts: 3, correct: 2 });
    expect(missedScenarios(s).map((m) => m.key)).toEqual(["hard 12|3"]);
    expect(s.history).toHaveLength(1);
  });

  it("only records a countdown personal best when the answer is correct", () => {
    let s = emptyStats();
    s = recordRcDrill(s, { at: 1, type: "deck", expected: 0, answer: 1, ms: 20000, cards: 52 });
    expect(s.rc.bestDeckMs).toBeNull();
    s = recordRcDrill(s, { at: 2, type: "deck", expected: 0, answer: 0, ms: 30000, cards: 52 });
    s = recordRcDrill(s, { at: 3, type: "deck", expected: -1, answer: -1, ms: 25000, cards: 52 });
    s = recordRcDrill(s, { at: 4, type: "deck", expected: 0, answer: 0, ms: 28000, cards: 52 });
    expect(s.rc.bestDeckMs).toBe(25000);
  });
});
