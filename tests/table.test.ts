import { describe, expect, it } from "vitest";
import type { Card, Rank } from "@/lib/blackjack/cards";
import { basicStrategyAction, withShoe, type GameState } from "@/lib/blackjack/engine";
import { seededRng, type Rng } from "@/lib/blackjack/rng";
import { DEFAULT_RULES, type TableRules } from "@/lib/blackjack/rules";
import { stackedShoe } from "@/lib/blackjack/shoe";
import { buildTableView } from "@/lib/blackjack/table-view";
import {
  betError,
  createTableSession,
  dealRound,
  humanBankroll,
  insuranceDecision,
  playerAction,
  rebuy,
  type TableSession,
} from "@/lib/blackjack/table-session";

function session(opts: { rules?: Partial<TableRules>; top?: Rank[]; humanSeat?: number; bankroll?: number; rng?: Rng } = {}): TableSession {
  const rng = opts.rng ?? seededRng(1);
  const rules = { ...DEFAULT_RULES, aiPlayers: 0, ...opts.rules };
  const s = createTableSession({ rules, humanSeat: opts.humanSeat ?? 0, bankroll: opts.bankroll ?? 1000 }, rng);
  return opts.top ? { ...s, state: withShoe(s.state, stackedShoe(rules.decks, opts.top, rng, rules.penetration)) } : s;
}

const ids = (cards: readonly { id: string }[]) => cards.map((c) => c.id);
const rng = seededRng(77);

/** Play the human with basic strategy until the round ends. */
function playOut(s: TableSession, r: Rng): TableSession {
  if (s.state.phase === "insurance") s = insuranceDecision(s, 0, r);
  while (s.state.phase === "playerTurn") s = playerAction(s, basicStrategyAction(s.state), r);
  return s;
}

describe("table session: complete rounds", () => {
  it("AI seats before the human act automatically; seats after act once the human finishes", () => {
    // Seats: AI(0), You(1), AI(2). Deal: s0 s1 s2 up s0 s1 s2 hole.
    // AI0: 10,6 vs 9 → hits (gets 2 → 18, stands). You: 10,7. AI2: 10,5 → hits.
    const top: Rank[] = ["10", "10", "10", "9", "6", "7", "5", "8", "2", "3", "3", "K"];
    let s = session({ rules: { aiPlayers: 2 }, humanSeat: 1, top });
    s = dealRound(s, 25, rng);
    expect(s.state.turn).toEqual({ seat: 1, hand: 0 });
    expect(s.state.seats[0].hands[0].done).toBe(true);
    expect(s.state.seats[0].hands[0].cards.length).toBeGreaterThan(2);
    s = playerAction(s, "stand", rng);
    expect(s.state.phase).toBe("roundOver");
    expect(s.state.seats[2].hands[0].cards.length).toBeGreaterThan(2);
    expect(s.stats.rounds).toBe(1);
    expect(s.stats.wagered).toBe(25);
    expect(humanBankroll(s)).toBe(1000 + s.lastRound!.net);
  });

  it("split: two hands, each settled, wager and bankroll account for both", () => {
    // You 8,8 vs dealer 6 (hole 10 = 16). Hand 1 gets 3 (11), hand 2 gets 9 (17).
    let s = session({ top: ["8", "6", "8", "10", "3", "9"] });
    s = dealRound(s, 10, rng);
    s = playerAction(s, "split", rng);
    expect(s.state.seats[0].hands).toHaveLength(2);
    s = playerAction(s, "stand", rng); // hand 1 on 11
    s = playerAction(s, "stand", rng); // hand 2 on 17
    expect(s.state.phase).toBe("roundOver");
    const hands = s.state.seats[0].hands;
    expect(s.stats.hands).toBe(2);
    expect(s.stats.wagered).toBe(20);
    expect(s.lastRound!.net).toBe(hands.reduce((n, h) => n + h.net!, 0));
    expect(humanBankroll(s)).toBe(1000 + s.lastRound!.net);
  });

  it("double: one card, doubled wager, doubled payout", () => {
    // You 6,5 vs dealer 9 (hole 8 = 17). Double gets K → 21.
    let s = session({ top: ["6", "9", "5", "8", "K"] });
    s = dealRound(s, 50, rng);
    s = playerAction(s, "double", rng);
    expect(s.state.phase).toBe("roundOver");
    expect(s.state.seats[0].hands[0].cards).toHaveLength(3);
    expect(s.lastRound).toMatchObject({ net: 100, wagered: 100, outcomes: ["win"] });
    expect(humanBankroll(s)).toBe(1100);
  });

  it("dealer blackjack ends the round at the deal and takes the original bet only", () => {
    let s = session({ top: ["9", "A", "9", "K"] });
    s = dealRound(s, 20, rng);
    expect(s.state.phase).toBe("insurance");
    s = insuranceDecision(s, 0, rng);
    expect(s.state.phase).toBe("roundOver");
    expect(s.lastRound).toMatchObject({ net: -20, outcomes: ["lose"] });
    expect(humanBankroll(s)).toBe(980);
  });

  it("player blackjack pays 3:2 and is recorded", () => {
    let s = session({ top: ["A", "9", "K", "7"] });
    s = dealRound(s, 10, rng);
    expect(s.lastRound).toMatchObject({ net: 15, outcomes: ["blackjack"] });
    expect(s.stats.blackjacks).toBe(1);
  });

  it("surrender returns half the bet", () => {
    let s = session({ rules: { surrender: "late" }, top: ["10", "10", "6", "8"] });
    s = dealRound(s, 10, rng);
    s = playerAction(s, "surrender", rng);
    expect(s.lastRound).toMatchObject({ net: -5, outcomes: ["surrender"] });
    expect(s.stats.surrenders).toBe(1);
  });

  it("validates bets against limits and bankroll, and supports buy-ins", () => {
    const s = session({ bankroll: 40 });
    expect(betError(s, 5)).toMatch(/minimum/);
    expect(betError(s, 1000)).toMatch(/maximum/);
    expect(betError(s, 50)).toMatch(/chips/);
    expect(betError(s, 40)).toBeNull();
    const more = rebuy(s, 500);
    expect(humanBankroll(more)).toBe(540);
    expect(more.stats.buyIns).toBe(500);
    expect(betError(more, 50)).toBeNull();
  });

  it("rejects actions when it is not the human's turn", () => {
    const s = session();
    expect(() => playerAction(s, "hit", rng)).toThrow();
  });
});

describe("shoe continuity across rounds", () => {
  it("deals one physical shoe in order until the cut card, then reshuffles before the next round", () => {
    const r = seededRng(5);
    let s = session({ rules: { decks: 2, aiPlayers: 3, penetration: 0.7 }, humanSeat: 2, rng: r });
    const shoe = s.state.shoe;
    const dealtOrder: string[] = [];
    let rounds = 0;
    while (!s.state.reshufflePending) {
      s = playOut(dealRound(s, 10, r), r);
      rounds++;
      expect(s.state.shoe.cards).toBe(shoe.cards); // same physical shoe object
      for (const e of s.state.log) if (e.type === "deal") dealtOrder.push(e.card.id);
    }
    expect(rounds).toBeGreaterThan(3);
    expect(s.state.shoe.position).toBeGreaterThanOrEqual(shoe.cutCardIndex);
    // Cards came out exactly in shoe order, each once.
    expect(dealtOrder).toEqual(ids(shoe.cards.slice(0, dealtOrder.length)));
    expect(new Set(dealtOrder).size).toBe(dealtOrder.length);
    expect(s.state.shoeNumber).toBe(1);

    s = dealRound(s, 10, r);
    expect(s.state.shoeNumber).toBe(2);
    expect(s.state.shoe.cards).not.toBe(shoe.cards);
    expect(s.state.log[0]).toEqual({ type: "shuffle", reason: "cut-card" });
    expect(s.state.count.valid).toBe(true);
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const r = seededRng(42);
      let s = session({ rules: { aiPlayers: 4 }, humanSeat: 3, rng: r });
      const nets: number[] = [];
      for (let i = 0; i < 60; i++) {
        s = playOut(dealRound(s, 10, r), r);
        nets.push(s.lastRound!.net);
      }
      return { nets, bankroll: humanBankroll(s), shoe: s.state.shoeNumber };
    };
    expect(run()).toEqual(run());
  });
});

describe("table view (UI projection)", () => {
  function holeCard(state: GameState): Card {
    return state.dealer.cards[1];
  }

  it("never contains the hole card, or undealt cards, before the reveal", () => {
    const r = seededRng(9);
    let s = session({ rules: { aiPlayers: 2 }, humanSeat: 1, rng: r });
    for (let round = 0; round < 40; round++) {
      s = dealRound(s, 10, r);
      // Every prefix during the human's decision and the deal.
      const check = (st: GameState) => {
        const hole = holeCard(st);
        const revealAt = st.log.findIndex((e) => e.type === "reveal");
        for (let k = 0; k <= st.log.length; k++) {
          const json = JSON.stringify(buildTableView(st, k));
          const revealed = revealAt >= 0 && k > revealAt;
          if (!revealed) expect(json.includes(`"${hole.id}"`), `hole leaked at ${k}`).toBe(false);
          const next = st.shoe.cards[st.shoe.position];
          if (next) expect(json.includes(`"${next.id}"`)).toBe(false);
        }
      };
      check(s.state);
      if (s.state.phase === "insurance") {
        s = insuranceDecision(s, 0, r);
        check(s.state);
      }
      while (s.state.phase === "playerTurn") {
        s = playerAction(s, basicStrategyAction(s.state), r);
        check(s.state);
      }
    }
  });

  it("replaying the full log reproduces the engine's hands, dealer and count", () => {
    const r = seededRng(13);
    let s = session({ rules: { aiPlayers: 3, maxSplitHands: 4 }, humanSeat: 0, rng: r });
    for (let round = 0; round < 150; round++) {
      s = playOut(dealRound(s, 10, r), r);
      const v = buildTableView(s.state);
      expect(v.settled).toBe(true);
      s.state.seats.forEach((seat, i) => {
        expect(v.seats[i].hands.map((h) => h.cards.map((c) => (c.faceDown ? null : c.id)))).toEqual(seat.hands.map((h) => ids(h.cards)));
        expect(v.seats[i].hands.map((h) => h.bet)).toEqual(seat.hands.map((h) => h.bet));
        expect(v.seats[i].bankroll).toBe(seat.bankroll);
      });
      expect(v.dealer.cards.map((c) => (c.faceDown ? null : c.id))).toEqual(ids(s.state.dealer.cards));
      expect(v.count).toEqual(s.state.count);
      expect(v.shoe.cardsInShoe + v.shoe.cardsInDiscard + v.shoe.cardsOnTable).toBe(v.shoe.totalCards);
    }
  });

  it("withholds outcomes, bankroll changes and the next decision until the animation catches up", () => {
    let s = session({ top: ["10", "6", "9", "10", "5"] });
    s = dealRound(s, 10, rng);
    const atDeal = buildTableView(s.state, 3); // two player cards and the upcard only
    expect(atDeal.phase).toBe("dealing");
    expect(atDeal.available).toEqual([]);
    expect(atDeal.dealer.cards).toHaveLength(1);
    s = playerAction(s, "stand", rng); // 19 vs 16 → dealer draws 5 → 21
    const before = buildTableView(s.state, s.state.log.length - 1);
    expect(before.settled).toBe(false);
    expect(before.seats[0].hands[0].outcome).toBeUndefined();
    expect(before.seats[0].bankroll).toBe(1000);
    const after = buildTableView(s.state);
    expect(after.settled).toBe(true);
    expect(after.seats[0].hands[0].outcome).toBe("lose");
    expect(after.seats[0].bankroll).toBe(990);
  });

  it("face-down cards carry no identity and the count ignores them", () => {
    const s = dealRound(session({ top: ["2", "9", "3", "K"] }), 10, rng);
    const v = buildTableView(s.state);
    expect(v.dealer.cards[1]).toEqual({ faceDown: true });
    expect(v.dealer.visibleValue?.total).toBe(9);
    expect(v.count.runningCount).toBe(2);
  });

  it("offers insurance against an Ace and reports the peek only after the decision", () => {
    let s = dealRound(session({ top: ["10", "A", "7", "9", "5"] }), 10, rng);
    const offer = buildTableView(s.state);
    expect(offer.phase).toBe("insurance");
    expect(offer.insuranceOffer).toEqual({ max: 5 });
    expect(offer.peekedNoBlackjack).toBe(false);
    expect(offer.dealer.cards[1]).toEqual({ faceDown: true });
    s = insuranceDecision(s, 5, rng);
    const after = buildTableView(s.state);
    expect(after.peekedNoBlackjack).toBe(true);
    expect(after.seats[0].insurance).toEqual({ amount: 5, net: -5 });
    // Before the peek event is animated, the insurance result and bankroll change stay hidden.
    const before = buildTableView(s.state, s.state.log.length - 1);
    expect(before.seats[0].insurance).toEqual({ amount: 5, net: undefined });
    expect(before.seats[0].bankroll).toBe(1000);
    expect(after.seats[0].bankroll).toBe(995);

    s = insuranceDecision(dealRound(session({ top: ["10", "A", "7", "K"] }), 10, rng), 5, rng);
    const bj = buildTableView(s.state);
    expect(bj.dealer.blackjack).toBe(true);
    expect(bj.seats[0].insurance).toEqual({ amount: 5, net: 10 });
    expect(s.lastRound).toMatchObject({ net: 0, insuranceAmount: 5, insuranceNet: 10 });
    expect(s.stats.insuranceTaken).toBe(1);
  });
});
