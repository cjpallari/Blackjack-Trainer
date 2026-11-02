import { describe, expect, it } from "vitest";
import { createDeck, makeCard, type Rank } from "@/lib/blackjack/cards";
import { hiLoValue, quarterDecks, roundTrueCount, runningCount, trueCount } from "@/lib/blackjack/counting";
import { dealerShouldHit } from "@/lib/blackjack/dealer";
import { handValue, isBlackjack, isPair } from "@/lib/blackjack/hand";
import { seededRng } from "@/lib/blackjack/rng";
import { createShoe } from "@/lib/blackjack/shoe";

const cards = (...ranks: Rank[]) => ranks.map((r, i) => makeCard(r, i % 2 ? "hearts" : "spades", i));

describe("hand evaluation", () => {
  it("counts a single ace as 11 when it does not bust", () => {
    expect(handValue(cards("A", "6"))).toEqual({ total: 17, soft: true, busted: false });
  });
  it("demotes the ace to 1 when needed", () => {
    expect(handValue(cards("A", "6", "9"))).toEqual({ total: 16, soft: false, busted: false });
  });
  it("handles multiple aces", () => {
    expect(handValue(cards("A", "A"))).toEqual({ total: 12, soft: true, busted: false });
    expect(handValue(cards("A", "A", "9"))).toEqual({ total: 21, soft: true, busted: false });
    expect(handValue(cards("A", "A", "A", "A", "10", "9"))).toEqual({ total: 23, soft: false, busted: true });
  });
  it("face cards are worth 10", () => {
    expect(handValue(cards("K", "Q")).total).toBe(20);
    expect(handValue(cards("J", "5", "7")).busted).toBe(true);
  });
  it("recognises naturals but not split 21s or three-card 21s", () => {
    expect(isBlackjack(cards("A", "K"))).toBe(true);
    expect(isBlackjack(cards("10", "A"))).toBe(true);
    expect(isBlackjack(cards("A", "K"), true)).toBe(false);
    expect(isBlackjack(cards("7", "7", "7"))).toBe(false);
    expect(isBlackjack(cards("A", "9"))).toBe(false);
  });
  it("treats any two ten-value cards as a pair", () => {
    expect(isPair(cards("K", "10"))).toBe(true);
    expect(isPair(cards("8", "8"))).toBe(true);
    expect(isPair(cards("8", "9"))).toBe(false);
  });
});

describe("dealer drawing", () => {
  it("hits soft 17 only under H17", () => {
    expect(dealerShouldHit(cards("A", "6"), { dealerHitsSoft17: true })).toBe(true);
    expect(dealerShouldHit(cards("A", "6"), { dealerHitsSoft17: false })).toBe(false);
    expect(dealerShouldHit(cards("A", "2", "4"), { dealerHitsSoft17: true })).toBe(true);
  });
  it("always stands on hard 17 and soft 18", () => {
    for (const h17 of [true, false]) {
      expect(dealerShouldHit(cards("10", "7"), { dealerHitsSoft17: h17 })).toBe(false);
      expect(dealerShouldHit(cards("A", "7"), { dealerHitsSoft17: h17 })).toBe(false);
      expect(dealerShouldHit(cards("10", "6"), { dealerHitsSoft17: h17 })).toBe(true);
    }
  });
});

describe("Hi-Lo counting", () => {
  it("tags ranks correctly", () => {
    for (const r of ["2", "3", "4", "5", "6"] as const) expect(hiLoValue(r)).toBe(1);
    for (const r of ["7", "8", "9"] as const) expect(hiLoValue(r)).toBe(0);
    for (const r of ["10", "J", "Q", "K", "A"] as const) expect(hiLoValue(r)).toBe(-1);
  });
  it("a full deck and full shoes count to zero", () => {
    expect(runningCount(createDeck())).toBe(0);
    for (const d of [1, 2, 6, 8]) expect(runningCount(createShoe(d, seededRng(d)).cards)).toBe(0);
  });
  it("running count of a partial sequence", () => {
    expect(runningCount(cards("2", "K", "5", "9", "A", "6", "3"))).toBe(2);
  });
});

describe("true count", () => {
  it("divides running count by decks remaining", () => {
    expect(trueCount(6, 1.5, "truncate")).toBe(4);
    expect(trueCount(-6, 1.5, "truncate")).toBe(-4);
    expect(trueCount(5, 2, "exact")).toBe(2.5);
  });
  it("applies rounding conventions", () => {
    expect(roundTrueCount(2.9, "truncate")).toBe(2);
    expect(roundTrueCount(-2.9, "truncate")).toBe(-2);
    expect(roundTrueCount(-0.5, "floor")).toBe(-1);
    expect(roundTrueCount(2.5, "nearest")).toBe(3);
    expect(roundTrueCount(-2.5, "nearest")).toBe(-3);
    expect(roundTrueCount(-0.4, "truncate")).toBe(0);
    expect(Object.is(roundTrueCount(-0.4, "truncate"), -0)).toBe(false);
  });
  it("is robust to floating-point noise", () => {
    expect(trueCount(3, 0.75, "truncate")).toBe(4);
    expect(trueCount(7, 1.75, "floor")).toBe(4);
  });
  it("rejects non-positive decks remaining", () => {
    expect(() => trueCount(3, 0, "truncate")).toThrow();
  });
  it("estimates quarter decks", () => {
    expect(quarterDecks(78)).toBe(1.5);
    expect(quarterDecks(40)).toBe(0.75);
    expect(quarterDecks(3)).toBe(0.25);
  });
});
