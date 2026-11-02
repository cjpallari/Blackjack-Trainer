import { describe, expect, it } from "vitest";
import type { Rank } from "@/lib/blackjack/cards";
import { runningCount } from "@/lib/blackjack/counting";
import {
  act,
  availableActions,
  basicStrategyAction,
  buyIn,
  createGame,
  IllegalActionError,
  runAiTurns,
  startRound,
  visibleCards,
  withShoe,
  type GameState,
} from "@/lib/blackjack/engine";
import { seededRng } from "@/lib/blackjack/rng";
import { DEFAULT_RULES, type TableRules } from "@/lib/blackjack/rules";
import { stackedShoe } from "@/lib/blackjack/shoe";

const rng = seededRng(99);

function setup(top: Rank[], rules: Partial<TableRules> = {}, seats = 1): GameState {
  const r: TableRules = { ...DEFAULT_RULES, ...rules };
  const configs = Array.from({ length: seats }, (_, i) => ({
    kind: i === 0 ? ("human" as const) : ("ai" as const),
    name: i === 0 ? "You" : `AI ${i}`,
    bankroll: 1000,
  }));
  const g = createGame(r, configs, rng);
  return withShoe(g, stackedShoe(r.decks, top, rng, r.penetration));
}

const bets = (n: number, amount = 10) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, amount]));
const ranks = (cards: readonly { rank: Rank }[]) => cards.map((c) => c.rank);

describe("dealing", () => {
  it("deals in casino order: seats, upcard, seats, hole card", () => {
    // seat0, seat1, up, seat0, seat1, hole
    let g = setup(["2", "3", "9", "4", "5", "7"], {}, 2);
    g = startRound(g, bets(2), rng);
    expect(ranks(g.seats[0].hands[0].cards)).toEqual(["2", "4"]);
    expect(ranks(g.seats[1].hands[0].cards)).toEqual(["3", "5"]);
    expect(ranks(g.dealer.cards)).toEqual(["9", "7"]);
    expect(g.dealer.holeRevealed).toBe(false);
    expect(g.turn).toEqual({ seat: 0, hand: 0 });
  });

  it("does not count the hole card until it is revealed", () => {
    let g = setup(["2", "9", "3", "K"]);
    g = startRound(g, bets(1), rng);
    expect(g.count.runningCount).toBe(2); // 2, 3 (+2), 9 (0); hole K hidden
    g = act(g, "stand", rng);
    expect(g.dealer.holeRevealed).toBe(true);
    expect(g.count.runningCount).toBe(runningCount(visibleCards(g)));
  });

  it("rejects bets outside the table limits", () => {
    const g = setup(["2", "3", "4", "5"]);
    expect(() => startRound(g, { 0: 5 }, rng)).toThrow(IllegalActionError);
    expect(() => startRound(g, { 0: 10000 }, rng)).toThrow(IllegalActionError);
  });
});

describe("blackjack and settlement", () => {
  it("dealer peeks: a dealer natural ends the round before players act", () => {
    let g = setup(["10", "A", "9", "K"]);
    g = startRound(g, bets(1), rng);
    expect(g.phase).toBe("roundOver");
    expect(g.seats[0].hands[0].outcome).toBe("lose");
    expect(g.seats[0].bankroll).toBe(990);
  });

  it("player natural vs dealer natural pushes", () => {
    let g = setup(["A", "A", "K", "K"]);
    g = startRound(g, bets(1), rng);
    expect(g.seats[0].hands[0].outcome).toBe("push");
    expect(g.seats[0].bankroll).toBe(1000);
  });

  it("pays naturals 3:2 or 6:5", () => {
    let g = setup(["A", "9", "K", "7"]);
    g = startRound(g, bets(1), rng);
    expect(g.phase).toBe("roundOver");
    expect(g.seats[0].hands[0].net).toBe(15);

    let g2 = setup(["A", "9", "K", "7"], { blackjackPayout: "6:5" });
    g2 = startRound(g2, bets(1), rng);
    expect(g2.seats[0].hands[0].net).toBe(12);
  });

  it("dealer does not draw when every player hand is already resolved", () => {
    let g = setup(["A", "6", "K", "2"]);
    g = startRound(g, bets(1), rng);
    expect(ranks(g.dealer.cards)).toEqual(["6", "2"]);
    expect(g.dealer.holeRevealed).toBe(true);
  });

  it("pushes on equal totals", () => {
    let g = setup(["10", "10", "8", "8"]);
    g = startRound(g, bets(1), rng);
    g = act(g, "stand", rng);
    expect(g.seats[0].hands[0].outcome).toBe("push");
    expect(g.seats[0].hands[0].net).toBe(0);
  });

  it("player bust loses even if the dealer would bust", () => {
    let g = setup(["10", "10", "6", "6", "K", "K"]);
    g = startRound(g, bets(1), rng);
    g = act(g, "hit", rng);
    expect(g.seats[0].hands[0].outcome).toBe("bust");
    expect(ranks(g.dealer.cards)).toEqual(["10", "6"]); // dealer does not draw
  });
});

describe("dealer soft 17", () => {
  // Player 10,9; dealer A,6; next card 2.
  const top: Rank[] = ["10", "A", "9", "6", "2"];
  it("H17: dealer hits soft 17", () => {
    let g = startRound(setup(top, { dealerHitsSoft17: true }), bets(1), rng);
    g = act(g, "stand", rng);
    expect(ranks(g.dealer.cards)).toEqual(["A", "6", "2"]);
    expect(g.seats[0].hands[0].outcome).toBe("push");
  });
  it("S17: dealer stands on soft 17", () => {
    let g = startRound(setup(top, { dealerHitsSoft17: false }), bets(1), rng);
    g = act(g, "stand", rng);
    expect(ranks(g.dealer.cards)).toEqual(["A", "6"]);
    expect(g.seats[0].hands[0].outcome).toBe("win");
  });
});

describe("doubling", () => {
  it("respects double restrictions", () => {
    const nine = startRound(setup(["5", "7", "4", "8"], { doubleRestriction: "10-11" }), bets(1), rng);
    expect(availableActions(nine)).not.toContain("double");
    const ten = startRound(setup(["6", "7", "4", "8"], { doubleRestriction: "10-11" }), bets(1), rng);
    expect(availableActions(ten)).toContain("double");
    const soft = startRound(setup(["A", "7", "7", "8"], { doubleRestriction: "9-11" }), bets(1), rng);
    expect(availableActions(soft)).not.toContain("double");
    const any = startRound(setup(["A", "7", "7", "8"], { doubleRestriction: "any2" }), bets(1), rng);
    expect(availableActions(any)).toContain("double");
  });

  it("doubles the bet, deals exactly one card and settles", () => {
    let g = startRound(setup(["6", "6", "5", "10", "K"]), bets(1), rng);
    g = act(g, "double", rng);
    const h = g.seats[0].hands[0];
    expect(h.cards).toHaveLength(3);
    expect(h.bet).toBe(20);
    // Player 21 vs dealer 16 → dealer draws.
    expect(h.outcome).toBe("win");
    expect(h.net).toBe(20);
  });

  it("is not available after hitting", () => {
    let g = startRound(setup(["2", "9", "3", "7", "2"]), bets(1), rng);
    g = act(g, "hit", rng);
    expect(availableActions(g)).not.toContain("double");
  });
});

describe("splitting", () => {
  it("splits into two hands, dealing the second hand's card when play reaches it", () => {
    // P 8, up 10, P 8, hole 7, then 3 (hand 1), 10 (hand 2)
    let g = startRound(setup(["8", "10", "8", "7", "3", "10"]), bets(1), rng);
    g = act(g, "split", rng);
    expect(g.seats[0].hands).toHaveLength(2);
    expect(ranks(g.seats[0].hands[0].cards)).toEqual(["8", "3"]);
    expect(ranks(g.seats[0].hands[1].cards)).toEqual(["8"]);
    expect(g.seats[0].hands[1].bet).toBe(10);
    g = act(g, "stand", rng);
    expect(ranks(g.seats[0].hands[1].cards)).toEqual(["8", "10"]);
    expect(g.turn).toEqual({ seat: 0, hand: 1 });
  });

  it("allows double after split only with DAS", () => {
    const top: Rank[] = ["8", "6", "8", "10", "3"];
    const das = act(startRound(setup(top, { doubleAfterSplit: true }), bets(1), rng), "split", rng);
    expect(availableActions(das)).toContain("double");
    const noDas = act(startRound(setup(top, { doubleAfterSplit: false }), bets(1), rng), "split", rng);
    expect(availableActions(noDas)).not.toContain("double");
  });

  it("split aces receive one card each and a split 21 is not a blackjack", () => {
    let g = startRound(setup(["A", "6", "A", "10", "K", "5"]), bets(1), rng);
    g = act(g, "split", rng);
    // Both aces get one card; hands are closed; dealer plays (16 → draws).
    expect(g.phase).toBe("roundOver");
    const [h1, h2] = g.seats[0].hands;
    expect(ranks(h1.cards)).toEqual(["A", "K"]);
    expect(ranks(h2.cards)).toEqual(["A", "5"]);
    expect(h1.outcome).not.toBe("blackjack");
    if (h1.outcome === "win") expect(h1.net).toBe(10);
  });

  it("does not resplit aces unless allowed", () => {
    const top: Rank[] = ["A", "6", "A", "10", "A", "9", "9"];
    const g = act(startRound(setup(top, { resplitAces: false }), bets(1), rng), "split", rng);
    expect(g.phase).toBe("roundOver");
    expect(g.seats[0].hands).toHaveLength(2);

    const g2 = act(startRound(setup(top, { resplitAces: true }), bets(1), rng), "split", rng);
    expect(g2.phase).toBe("playerTurn");
    expect(availableActions(g2)).toEqual(["stand", "split"]);
  });

  it("enforces the maximum number of split hands", () => {
    const top: Rank[] = ["8", "6", "8", "10", "8", "8", "8"];
    const two = act(startRound(setup(top, { maxSplitHands: 2 }), bets(1), rng), "split", rng);
    expect(availableActions(two)).not.toContain("split");
    let four = act(startRound(setup(top, { maxSplitHands: 4 }), bets(1), rng), "split", rng);
    expect(availableActions(four)).toContain("split");
    four = act(four, "split", rng);
    four = act(four, "split", rng);
    expect(four.seats[0].hands).toHaveLength(4);
    expect(availableActions(four)).not.toContain("split");
  });
});

describe("surrender", () => {
  it("returns half the bet and is only offered on the first two cards", () => {
    let g = startRound(setup(["10", "10", "6", "7"], { surrender: "late" }), bets(1), rng);
    expect(availableActions(g)).toContain("surrender");
    g = act(g, "surrender", rng);
    expect(g.seats[0].hands[0].outcome).toBe("surrender");
    expect(g.seats[0].bankroll).toBe(995);

    let h = startRound(setup(["2", "10", "3", "7", "2"], { surrender: "late" }), bets(1), rng);
    h = act(h, "hit", rng);
    expect(availableActions(h)).not.toContain("surrender");
  });

  it("is unavailable when the rules disallow it", () => {
    const g = startRound(setup(["10", "10", "6", "7"], { surrender: "none" }), bets(1), rng);
    expect(availableActions(g)).not.toContain("surrender");
  });
});

describe("shoe progression", () => {
  it("finishes the round when the cut card comes out and reshuffles before the next", () => {
    let g = createGame({ ...DEFAULT_RULES, decks: 1, penetration: 0.5 }, [{ kind: "human", name: "You", bankroll: 1000 }], seededRng(5));
    let rounds = 0;
    while (!g.reshufflePending) {
      g = startRound(g, bets(1), rng);
      while (g.phase === "playerTurn") g = act(g, basicStrategyAction(g), rng);
      rounds++;
      expect(g.shoeNumber).toBe(1);
    }
    expect(g.shoe.position).toBeGreaterThanOrEqual(26);
    expect(rounds).toBeGreaterThan(2);
    g = startRound(g, bets(1), rng);
    expect(g.shoeNumber).toBe(2);
    expect(g.roundsThisShoe).toBe(1);
    expect(g.log[0]).toEqual({ type: "shuffle", reason: "cut-card" });
  });

  it("ends the shoe early, before dealing, when too few cards remain for a round", () => {
    let g = setup([], { decks: 1 }, 1);
    g = { ...g, shoe: { ...g.shoe, position: 49, cutCardIndex: 52 } };
    g = startRound(g, bets(1), rng);
    expect(g.log[0]).toEqual({ type: "shuffle", reason: "insufficient-cards" });
    expect(g.shoeNumber).toBe(2);
    expect(g.count.valid).toBe(true);
  });

  it("recovers from mid-round exhaustion, keeps the original shoe and flags the count", () => {
    let g = setup([], { decks: 1 }, 1);
    // Last 8 cards: P A, D 2, P A, hole 2, then A A 2 2 → player soft 18 with nothing left.
    const stacked = stackedShoe(1, ["A", "2", "A", "2", "A", "A", "2", "2"], rng);
    const cards = [...stacked.cards.slice(8), ...stacked.cards.slice(0, 8)];
    const original = { decks: 1, cards, position: 44, cutCardIndex: 52 };
    g = { ...g, shoe: original };
    g = startRound(g, bets(1), rng);
    for (let i = 0; i < 4; i++) g = act(g, "hit", rng);
    expect(g.interruptedShoe).toBeNull(); // not yet exhausted
    g = act(g, "hit", rng); // forces the emergency reshuffle
    while (g.phase === "playerTurn") g = act(g, "stand", rng);

    expect(g.log.some((e) => e.type === "shuffle" && e.reason === "exhausted")).toBe(true);
    expect(g.interruptedShoe!.cards).toBe(original.cards);
    expect(g.interruptedShoe!.position).toBe(52);
    expect(g.interruptedShoe!.cards.map((c) => c.id)).toEqual(cards.map((c) => c.id));
    expect(g.count.valid).toBe(false);
    expect(g.reshufflePending).toBe(true);
    const onTable = visibleCards(g).map((c) => c.id);
    expect(new Set(onTable).size).toBe(onTable.length);
    // The count covers only cards drawn from the makeshift pack; the old-pack hole card is excluded.
    expect(g.count.runningCount).toBe(runningCount(g.shoe.cards.slice(0, g.shoe.position)));

    // Next round starts a genuinely fresh shoe with a valid count.
    g = startRound(g, bets(1), rng);
    expect(g.count.valid).toBe(true);
    expect(g.interruptedShoe).toBeNull();
  });
});

describe("bankroll", () => {
  it("rejects bets the seat cannot cover", () => {
    const g = setup(["2", "3", "4", "5"]);
    const poor = { ...g, seats: g.seats.map((s) => ({ ...s, bankroll: 5 })) };
    expect(() => startRound({ ...poor, rules: { ...poor.rules, minBet: 1 } }, { 0: 10 }, rng)).toThrow(IllegalActionError);
  });

  it("offers double and split only when the bankroll covers the extra wager", () => {
    const top: Rank[] = ["8", "6", "8", "10"];
    const g = setup(top);
    const rich = startRound(g, { 0: 10 }, rng);
    expect(availableActions(rich)).toEqual(expect.arrayContaining(["double", "split"]));
    const tight = startRound({ ...g, seats: g.seats.map((s) => ({ ...s, bankroll: 15 })) }, { 0: 10 }, rng);
    expect(availableActions(tight)).not.toContain("double");
    expect(availableActions(tight)).not.toContain("split");
  });

  it("buy-ins add chips between rounds only", () => {
    const g = setup(["2", "3", "4", "5", "6", "7"]);
    expect(buyIn(g, 0, 500).seats[0].bankroll).toBe(1500);
    const playing = startRound(setup(["2", "9", "3", "7"]), bets(1), rng);
    expect(() => buyIn(playing, 0, 100)).toThrow(IllegalActionError);
  });
});

describe("integration: many complete rounds", () => {
  it.each([
    ["2-deck H17", { decks: 2 as const }],
    ["6-deck S17 LS", { decks: 6 as const, dealerHitsSoft17: false, surrender: "late" as const }],
    ["1-deck no DAS", { decks: 1 as const, doubleAfterSplit: false, maxSplitHands: 2 as const }],
  ])("%s: preserves composition and accounting", (_, overrides) => {
    const r = seededRng(2024);
    const rules = { ...DEFAULT_RULES, ...overrides };
    const start = 1_000_000;
    const seats = [
      { kind: "ai" as const, name: "AI 1", bankroll: start },
      { kind: "human" as const, name: "You", bankroll: start },
      { kind: "ai" as const, name: "AI 2", bankroll: start },
    ];
    let g = createGame(rules, seats, r);
    let shoeSeen = new Set<string>();
    let shoeNumber = g.shoeNumber;
    const nets = [0, 0, 0];
    for (let round = 0; round < 400; round++) {
      g = startRound(g, bets(3), r);
      if (g.shoeNumber !== shoeNumber) {
        shoeNumber = g.shoeNumber;
        shoeSeen = new Set();
      }
      g = runAiTurns(g, r);
      while (g.phase === "playerTurn") {
        g = act(g, basicStrategyAction(g), r);
        g = runAiTurns(g, r);
      }
      expect(g.phase).toBe("roundOver");
      const exhausted = !g.count.valid;
      const roundCards = visibleCards(g);
      for (const c of roundCards) {
        if (!exhausted) expect(shoeSeen.has(c.id), `duplicate ${c.id}`).toBe(false);
        shoeSeen.add(c.id);
      }
      expect(g.dealer.holeRevealed).toBe(true);
      expect(g.count.runningCount).toBe(runningCount(g.shoe.cards.slice(0, g.shoe.position)));
      g.seats.forEach((s, i) => {
        for (const h of s.hands) {
          expect(h.outcome).toBeDefined();
          nets[i] += h.net!;
        }
        expect(s.bankroll - start).toBeCloseTo(nets[i], 9);
      });
    }
    expect(g.roundNumber).toBe(400);
    expect(g.shoeNumber).toBeGreaterThan(1);
  });
});
