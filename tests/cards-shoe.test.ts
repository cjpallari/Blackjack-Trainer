import { describe, expect, it } from "vitest";
import { createDeck, pointRank, RANKS, SUITS } from "@/lib/blackjack/cards";
import { seededRng, shuffle } from "@/lib/blackjack/rng";
import {
  cardsRemaining,
  createShoe,
  cutCardReached,
  drawCard,
  drawCards,
  ShoeExhaustedError,
  stackedShoe,
} from "@/lib/blackjack/shoe";

describe("deck composition", () => {
  it("has 52 unique cards: 4 of each rank, 13 of each suit", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
    for (const r of RANKS) expect(deck.filter((c) => c.rank === r)).toHaveLength(4);
    for (const s of SUITS) expect(deck.filter((c) => c.suit === s)).toHaveLength(13);
  });

  it("has 16 ten-value cards per deck", () => {
    expect(createDeck().filter((c) => pointRank(c.rank) === 10)).toHaveLength(16);
  });
});

describe("Fisher–Yates shuffle", () => {
  it("returns a permutation and does not mutate the input", () => {
    const input = Array.from({ length: 100 }, (_, i) => i);
    const out = shuffle(input, seededRng(1));
    expect(input).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(out).not.toEqual(input);
  });

  it("is deterministic for a given seed", () => {
    const a = shuffle(createDeck(), seededRng(42)).map((c) => c.id);
    const b = shuffle(createDeck(), seededRng(42)).map((c) => c.id);
    const c = shuffle(createDeck(), seededRng(43)).map((c) => c.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("produces all 6 permutations of 3 items roughly uniformly", () => {
    const rng = seededRng(7);
    const counts = new Map<string, number>();
    const n = 60000;
    for (let i = 0; i < n; i++) {
      const key = shuffle([1, 2, 3], rng).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    // Chi-square with 5 dof; 20.5 is the 0.1% critical value.
    const expected = n / 6;
    let chi = 0;
    for (const v of counts.values()) chi += (v - expected) ** 2 / expected;
    expect(chi).toBeLessThan(20.5);
  });
});

describe("shoe", () => {
  it.each([1, 2, 4, 6, 8])("%i-deck shoe contains every card exactly once per deck", (decks) => {
    const shoe = createShoe(decks, seededRng(decks));
    expect(shoe.cards).toHaveLength(52 * decks);
    expect(new Set(shoe.cards.map((c) => c.id)).size).toBe(52 * decks);
    for (const r of RANKS) expect(shoe.cards.filter((c) => c.rank === r)).toHaveLength(4 * decks);
  });

  it("deals without replacement and never repeats a card", () => {
    let shoe = createShoe(2, seededRng(3));
    const seen = new Set<string>();
    while (cardsRemaining(shoe) > 0) {
      const r = drawCard(shoe);
      expect(seen.has(r.card.id)).toBe(false);
      seen.add(r.card.id);
      shoe = r.shoe;
    }
    expect(seen.size).toBe(104);
    expect(() => drawCard(shoe)).toThrow(ShoeExhaustedError);
  });

  it("drawing is pure: the original shoe is unchanged", () => {
    const shoe = createShoe(1, seededRng(5));
    const { shoe: next } = drawCards(shoe, 5);
    expect(shoe.position).toBe(0);
    expect(next.position).toBe(5);
  });

  it("places the cut card at the penetration point", () => {
    const shoe = createShoe(2, seededRng(1), 0.7);
    expect(shoe.cutCardIndex).toBe(Math.round(104 * 0.7));
    expect(cutCardReached(shoe)).toBe(false);
    const { shoe: after } = drawCards(shoe, shoe.cutCardIndex);
    expect(cutCardReached(after)).toBe(true);
  });

  it("stacked shoes keep a legal composition", () => {
    const shoe = stackedShoe(1, ["A", "A", "A", "A"], seededRng(1));
    expect(shoe.cards.slice(0, 4).every((c) => c.rank === "A")).toBe(true);
    expect(shoe.cards.filter((c) => c.rank === "A")).toHaveLength(4);
    expect(new Set(shoe.cards.map((c) => c.id)).size).toBe(52);
    expect(() => stackedShoe(1, ["A", "A", "A", "A", "A"], seededRng(1))).toThrow();
  });
});
