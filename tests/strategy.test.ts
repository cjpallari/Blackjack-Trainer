import { describe, expect, it } from "vitest";
import type { PointRank } from "@/lib/blackjack/cards";
import { generateStrategyTable } from "@/lib/blackjack/analysis/generate";
import { chartCode, evaluateDecision, strategyTableFor, TIE_EPSILON } from "@/lib/blackjack/strategy";
import type { StrategyTable } from "@/lib/blackjack/strategy-table";
import oneDeckS17 from "@/lib/blackjack/strategy-data/1D-S17.json";

/**
 * Published multi-deck basic strategy (4–8 decks, DAS, late surrender), as
 * printed in the standard Wizard of Odds / Griffin-style charts. Columns are
 * dealer 2,3,4,5,6,7,8,9,10,A. The generated tables come from an independent
 * combinatorial analysis, so agreement here validates the analyzer.
 */
const SIX_DECK_S17_DAS_LS = `
H8  H H H H H H H H H H
H9  H D D D D H H H H H
H10 D D D D D D D D H H
H11 D D D D D D D D D H
H12 H H S S S H H H H H
H13 S S S S S H H H H H
H14 S S S S S H H H H H
H15 S S S S S H H H R H
H16 S S S S S H H R R R
H17 S S S S S S S S S S
S13 H H H D D H H H H H
S14 H H H D D H H H H H
S15 H H D D D H H H H H
S16 H H D D D H H H H H
S17 H D D D D H H H H H
S18 S Ds Ds Ds Ds S S H H H
S19 S S S S S S S S S S
P2  P P P P P P H H H H
P3  P P P P P P H H H H
P4  H H H P P H H H H H
P5  D D D D D D D D H H
P6  P P P P P H H H H H
P7  P P P P P P H H H H
P8  P P P P P P P P P P
P9  P P P P P S P P S S
P10 S S S S S S S S S S
P1  P P P P P P P P P P`;

/** Differences from the S17 chart that the published H17 chart lists. */
const SIX_DECK_H17_CHANGES: Record<string, string[]> = {
  H11: ["1", "D"],
  H15: ["1", "R"],
  H17: ["1", "Rs"],
  S18: ["2", "Ds"],
  S19: ["6", "Ds"],
  P8: ["1", "Rp"],
};

const UPS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "1"];

function parseChart(text: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const line of text.trim().split("\n")) {
    const [key, ...codes] = line.trim().split(/\s+/);
    m.set(key, codes);
  }
  return m;
}

function computedRow(table: StrategyTable, key: string, rules: { doubleAfterSplit: boolean; surrender: "late" | "none" }) {
  const kind = key[0];
  const n = key.slice(1);
  const row = kind === "H" ? table.hard[n] : kind === "S" ? table.soft[n] : table.pairs[n];
  return UPS.map((u) => chartCode(row[u], rules, kind === "P"));
}

describe("generated strategy matches published 6-deck charts", () => {
  const rules = { doubleAfterSplit: true, surrender: "late" as const };

  it("6 decks, S17, DAS, LS", () => {
    const table = strategyTableFor({ variant: "standard", decks: 6, dealerHitsSoft17: false });
    for (const [key, codes] of parseChart(SIX_DECK_S17_DAS_LS)) {
      expect(computedRow(table, key, rules), key).toEqual(codes);
    }
  });

  it("6 decks, H17, DAS, LS", () => {
    const table = strategyTableFor({ variant: "standard", decks: 6, dealerHitsSoft17: true });
    const expected = parseChart(SIX_DECK_S17_DAS_LS);
    for (const [key, [up, code]] of Object.entries(SIX_DECK_H17_CHANGES)) {
      expected.get(key)![UPS.indexOf(up)] = code;
    }
    for (const [key, codes] of expected) {
      expect(computedRow(table, key, rules), key).toEqual(codes);
    }
  });

  it("6 decks, no DAS pair rows", () => {
    const table = strategyTableFor({ variant: "standard", decks: 6, dealerHitsSoft17: false });
    const noDas = { doubleAfterSplit: false, surrender: "none" as const };
    expect(computedRow(table, "P2", noDas)).toEqual("H H P P P P H H H H".split(" "));
    expect(computedRow(table, "P3", noDas)).toEqual("H H P P P P H H H H".split(" "));
    expect(computedRow(table, "P4", noDas)).toEqual("H H H H H H H H H H".split(" "));
    expect(computedRow(table, "P6", noDas)).toEqual("H P P P P H H H H H".split(" "));
  });
});

describe("deck-count dependent differences", () => {
  const rules = { doubleAfterSplit: true, surrender: "none" as const };
  it("double deck differs from six deck where published charts differ", () => {
    const two = strategyTableFor({ variant: "standard", decks: 2, dealerHitsSoft17: true });
    const six = strategyTableFor({ variant: "standard", decks: 6, dealerHitsSoft17: true });
    // 9 v 2: double in double-deck, hit in six-deck.
    expect(chartCode(two.hard[9]["2"], rules, false)).toBe("D");
    expect(chartCode(six.hard[9]["2"], rules, false)).toBe("H");
    // 7,7 v 8 and 6,6 v 7 split with DAS in double-deck only.
    expect(chartCode(two.pairs[7]["8"], rules, true)).toBe("P");
    expect(chartCode(six.pairs[7]["8"], rules, true)).toBe("H");
    expect(chartCode(two.pairs[6]["7"], rules, true)).toBe("P");
    expect(chartCode(six.pairs[6]["7"], rules, true)).toBe("H");
  });

  it("single deck doubles 8 v 5–6 and 4,4 v 5–6 without DAS", () => {
    const one = strategyTableFor({ variant: "standard", decks: 1, dealerHitsSoft17: false });
    const noDas = { doubleAfterSplit: false, surrender: "none" as const };
    expect(chartCode(one.hard[8]["5"], noDas, false)).toBe("D");
    expect(chartCode(one.hard[8]["6"], noDas, false)).toBe("D");
    expect(chartCode(one.pairs[4]["5"], noDas, true)).toBe("D");
  });
});

describe("evaluateDecision", () => {
  const table = strategyTableFor({ variant: "standard", decks: 6, dealerHitsSoft17: false });
  const rules = { doubleAfterSplit: true };
  const ev = (cards: PointRank[], up: PointRank, available: Parameters<typeof evaluateDecision>[2]["available"]) =>
    evaluateDecision(table, rules, { cards, up, available });

  it("recommends the best legal action", () => {
    expect(ev([10, 6], 10, ["hit", "stand", "double", "surrender"]).best).toBe("surrender");
    expect(ev([10, 6], 10, ["hit", "stand", "double"]).best).toBe("hit");
    expect(ev([8, 8], 10, ["hit", "stand", "double", "split"]).best).toBe("split");
  });

  it("falls back correctly when doubling is unavailable", () => {
    // Soft 18 v 4: double, else stand.
    expect(ev([1, 7], 4, ["hit", "stand", "double"]).best).toBe("double");
    expect(ev([1, 4, 3], 4, ["hit", "stand"]).best).toBe("stand");
    // Hard 11 v 6: double, else hit.
    expect(ev([5, 6], 6, ["hit", "stand"]).best).toBe("hit");
  });

  it("uses the hard/soft chart for a pair that can no longer be split", () => {
    const r = ev([8, 8], 10, ["hit", "stand"]);
    expect(r.category).toBe("hard");
    expect(r.best).toBe("hit");
  });

  it("always stands on 21", () => {
    expect(ev([1, 5, 5], 6, ["hit", "stand"]).best).toBe("stand");
  });

  it("accepts every action within the tie tolerance and only those", () => {
    const r = ev([10, 6], 7, ["hit", "stand", "double"]);
    for (const a of r.acceptable) expect(r.evs[r.best]! - r.evs[a]!).toBeLessThan(TIE_EPSILON);
    expect(r.acceptable).toEqual(["hit"]);
  });
});

describe("committed tables are reproducible", () => {
  it("1D-S17.json matches a fresh analysis", () => {
    const fresh = generateStrategyTable({ decks: 1, dealerHitsSoft17: false });
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(oneDeckS17);
  }, 30000);

  it("EVs are internally consistent", () => {
    const t = strategyTableFor({ variant: "standard", decks: 2, dealerHitsSoft17: true });
    // Standing on 20 v 6 is strongly favourable; 16 v 10 is a large loss either way.
    expect(t.hard[20]["6"].stand).toBeGreaterThan(0.6);
    expect(t.hard[16]["10"].stand).toBeLessThan(-0.5);
    // A double can never be worth more than twice the best single-card outcome range.
    for (const row of Object.values(t.hard))
      for (const c of Object.values(row)) {
        expect(c.double).toBeGreaterThanOrEqual(-2);
        expect(c.double).toBeLessThanOrEqual(2);
        expect(c.stand).toBeGreaterThanOrEqual(-1);
        expect(c.stand).toBeLessThanOrEqual(1);
      }
  });
});
