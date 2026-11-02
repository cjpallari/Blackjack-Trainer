/**
 * Read-only projection of a GameState for the table UI.
 *
 * The engine resolves transitions atomically (a whole deal, or every AI move
 * and the dealer's draw after the player's last action). The UI animates by
 * replaying the round's event log one event at a time: `buildTableView(state,
 * revealed)` shows the table as of the first `revealed` events.
 *
 * Information boundary: the view never contains the shoe's card order, and
 * a face-down card carries no rank, suit or id. Outcomes, bankroll changes and
 * the next decision only appear once the animation has caught up with the
 * engine. UI code and the Phase 6 counting overlay should read this view, not
 * the GameState.
 */
import type { Card, Rank, Suit } from "./cards";
import { hiLoValue } from "./counting";
import { availableActions, maxInsurance, type GameEvent, type GameState, type HandOutcome, type ShuffleReason, type TurnPointer } from "./engine";
import { handValue, isBlackjack, type HandValue } from "./hand";
import type { PlayerAction } from "./strategy";

export type CardView =
  | { readonly faceDown: true }
  | { readonly faceDown: false; readonly id: string; readonly rank: Rank; readonly suit: Suit };

export interface HandView {
  readonly cards: readonly CardView[];
  readonly bet: number;
  readonly doubled: boolean;
  readonly surrendered: boolean;
  readonly fromSplit: boolean;
  readonly value: HandValue | null;
  readonly blackjack: boolean;
  readonly outcome?: HandOutcome;
  readonly net?: number;
}

export interface SeatView {
  readonly id: number;
  readonly name: string;
  readonly kind: "human" | "ai";
  /** Bankroll as the player sees it: pre-settlement until results are shown. */
  readonly bankroll: number;
  readonly inRound: boolean;
  readonly hands: readonly HandView[];
  /** Net result of the round for this seat's hands, once settled (insurance separate). */
  readonly roundNet?: number;
  /** Insurance taken this round; `net` appears once the peek has been shown. */
  readonly insurance: { readonly amount: number; readonly net?: number } | null;
}

export interface DealerView {
  readonly cards: readonly CardView[];
  readonly holeRevealed: boolean;
  /** Value of the face-up cards only. */
  readonly visibleValue: HandValue | null;
  readonly blackjack: boolean;
}

export interface ShoeView {
  readonly decks: number;
  readonly totalCards: number;
  /** Cards physically still in the shoe. */
  readonly cardsInShoe: number;
  /** Cards in the discard tray (from completed rounds of this shoe). */
  readonly cardsInDiscard: number;
  readonly cardsOnTable: number;
  /** Position of the cut card counted from the front of the shoe (visible on the table). */
  readonly cutCardIndex: number;
  readonly cutCardOut: boolean;
  readonly shoeNumber: number;
  readonly roundsThisShoe: number;
  /** True if this round had to reshuffle the discards mid-round. */
  readonly interrupted: boolean;
}

/** Hi-Lo count of exposed cards only. Reserved for the Phase 6 overlay; not rendered in Phase 5. */
export interface CountView {
  readonly runningCount: number;
  readonly cardsSeen: number;
  readonly valid: boolean;
}

export type ViewPhase = "idle" | "dealing" | "insurance" | "playerTurn" | "roundOver";

export interface TableView {
  readonly roundNumber: number;
  readonly phase: ViewPhase;
  /** Animation has caught up and the round is over: outcomes are visible. */
  readonly settled: boolean;
  readonly seats: readonly SeatView[];
  readonly dealer: DealerView;
  /** Hand to act on, once the animation has caught up. */
  readonly turn: TurnPointer | null;
  /** Legal actions for the human, when it is their turn. */
  readonly available: readonly PlayerAction[];
  /** Insurance offer to the human (dealer shows an Ace), with the maximum stake. */
  readonly insuranceOffer: { readonly max: number } | null;
  readonly shoe: ShoeView;
  readonly count: CountView;
  /** Shuffle events revealed so far this round. */
  readonly shuffles: readonly ShuffleReason[];
  /** The dealer checked a 10/A upcard for blackjack and play continued. */
  readonly peekedNoBlackjack: boolean;
}

interface ReplayHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  surrendered: boolean;
  fromSplit: boolean;
}

const faceUp = (c: Card): CardView => ({ faceDown: false, id: c.id, rank: c.rank, suit: c.suit });

export function buildTableView(state: GameState, revealed: number = state.log.length): TableView {
  const events = state.log.slice(0, Math.max(0, Math.min(revealed, state.log.length)));
  const caughtUp = events.length === state.log.length;
  const started = state.roundNumber > 0;

  const hands = new Map<number, ReplayHand[]>();
  const insurance = new Map<number, number>();
  let peeked = false;
  const dealer: { card: Card; faceDown: boolean }[] = [];
  let holeRevealed = false;
  let count = { ...state.roundStart.count };
  let dealtThisRound = 0;
  let drawnAfterSwitch = 0;
  let packSwitched = false;
  let holeFromOldPack = false;
  const shuffles: ShuffleReason[] = [];

  const exposeCard = (c: Card) => {
    count = { ...count, runningCount: count.runningCount + hiLoValue(c.rank), cardsSeen: count.cardsSeen + 1 };
  };

  for (const e of events) {
    switch (e.type) {
      case "shuffle":
        shuffles.push(e.reason);
        if (e.reason === "exhausted") {
          packSwitched = true;
          count = { runningCount: 0, cardsSeen: 0, valid: false };
          if (dealer.length >= 2 && !holeRevealed) holeFromOldPack = true;
        }
        break;
      case "bet":
        hands.set(e.seat, [{ cards: [], bet: e.amount, doubled: false, surrendered: false, fromSplit: false }]);
        break;
      case "insurance":
        insurance.set(e.seat, e.amount);
        break;
      case "peek":
        peeked = true;
        break;
      case "deal":
        dealtThisRound++;
        if (packSwitched) drawnAfterSwitch++;
        if (e.to === "dealer") dealer.push({ card: e.card, faceDown: e.faceDown });
        else hands.get(e.seat!)![e.hand!].cards.push(e.card);
        if (!e.faceDown) exposeCard(e.card);
        break;
      case "reveal":
        holeRevealed = true;
        dealer[1].faceDown = false;
        if (!holeFromOldPack) exposeCard(dealer[1].card);
        break;
      case "action": {
        const seatHands = hands.get(e.seat)!;
        const h = seatHands[e.hand];
        if (e.action === "double") {
          h.bet *= 2;
          h.doubled = true;
        } else if (e.action === "surrender") {
          h.surrendered = true;
        } else if (e.action === "split") {
          const second = h.cards.pop()!;
          h.fromSplit = true;
          seatHands.splice(e.hand + 1, 0, { cards: [second], bet: h.bet, doubled: false, surrendered: false, fromSplit: true });
        }
        break;
      }
    }
  }

  const settled = caughtUp && state.phase === "roundOver" && started;

  const seats: SeatView[] = state.seats.map((seat) => {
    const replay = hands.get(seat.id) ?? [];
    const finalHands = seat.hands;
    const roundNet = finalHands.reduce((sum, h) => sum + (h.net ?? 0), 0);
    const ins = insurance.get(seat.id);
    // Insurance is settled at the peek; until the player has seen the peek (or the round's end), hide its result.
    const insuranceShown = peeked || settled;
    const hiddenInsuranceNet = seat.insurance && !insuranceShown ? seat.insurance.net : 0;
    const hiddenHandNet = state.phase === "roundOver" && !settled ? roundNet : 0;
    return {
      id: seat.id,
      name: seat.name,
      kind: seat.kind,
      bankroll: seat.bankroll - hiddenHandNet - hiddenInsuranceNet,
      insurance: ins === undefined ? null : { amount: ins, net: insuranceShown ? seat.insurance?.net : undefined },
      inRound: replay.length > 0,
      roundNet: settled && replay.length > 0 ? roundNet : undefined,
      hands: replay.map((h, i) => ({
        cards: h.cards.map(faceUp),
        bet: h.bet,
        doubled: h.doubled,
        surrendered: h.surrendered,
        fromSplit: h.fromSplit,
        value: h.cards.length ? handValue(h.cards) : null,
        blackjack: isBlackjack(h.cards, h.fromSplit),
        outcome: settled ? finalHands[i]?.outcome : undefined,
        net: settled ? finalHands[i]?.net : undefined,
      })),
    };
  });

  const visibleDealer = dealer.filter((d) => !d.faceDown).map((d) => d.card);
  const turn = caughtUp && state.phase === "playerTurn" ? state.turn : null;
  const human = state.seats.find((s) => s.kind === "human");
  const insuranceOffer =
    caughtUp && state.phase === "insurance" && human && human.hands.length > 0 ? { max: maxInsurance(state, human.id) } : null;
  const humanTurn = turn !== null && state.seats[turn.seat].kind === "human";

  const shoeTotal = state.rules.decks * 52;
  const interrupted = packSwitched;
  const position = state.roundStart.shoePosition + dealtThisRound;

  return {
    roundNumber: state.roundNumber,
    phase: !started ? "idle" : !caughtUp ? "dealing" : state.phase === "playerTurn" ? "playerTurn" : state.phase === "insurance" ? "insurance" : "roundOver",
    settled,
    seats,
    dealer: {
      cards: dealer.map((d) => (d.faceDown ? { faceDown: true as const } : faceUp(d.card))),
      holeRevealed,
      visibleValue: visibleDealer.length ? handValue(visibleDealer) : null,
      blackjack: holeRevealed && isBlackjack(dealer.map((d) => d.card)),
    },
    turn,
    available: humanTurn ? availableActions(state) : [],
    insuranceOffer,
    shoe: {
      decks: state.rules.decks,
      totalCards: shoeTotal,
      cardsInShoe: interrupted ? state.shoe.cards.length - drawnAfterSwitch : shoeTotal - position,
      cardsInDiscard: interrupted ? 0 : state.roundStart.shoePosition,
      cardsOnTable: dealtThisRound,
      cutCardIndex: state.shoe.cutCardIndex,
      cutCardOut: interrupted || position >= state.shoe.cutCardIndex,
      shoeNumber: state.shoeNumber,
      roundsThisShoe: state.roundsThisShoe,
      interrupted,
    },
    count,
    shuffles,
    peekedNoBlackjack: peeked,
  };
}

/** Relative animation weight of an event (multiplied by the speed's base delay). */
export function eventWeight(e: GameEvent): number {
  switch (e.type) {
    case "deal":
      return 1;
    case "reveal":
      return 1.2;
    case "shuffle":
      return 2.5;
    case "action":
      return 0.4;
    case "bet":
    case "insurance":
      return 0;
    case "peek":
      return 1;
  }
}
