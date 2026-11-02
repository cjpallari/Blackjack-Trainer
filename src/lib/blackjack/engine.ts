/**
 * Deterministic blackjack table engine. Pure state transitions: every public
 * function returns a new GameState and never mutates its input. Randomness is
 * only consumed when a new shoe is shuffled, via the injected Rng.
 */
import { pointRank, type Card, type PointRank } from "./cards";
import { hiLoValue } from "./counting";
import { dealerShouldHit } from "./dealer";
import { handValue, isBlackjack, isPair } from "./hand";
import { shuffle, type Rng } from "./rng";
import { canDoubleTotal, naturalPayout, type TableRules } from "./rules";
import { cardsRemaining, createShoe, cutCardReached, type Shoe } from "./shoe";
import { evaluateDecision, strategyTableFor, type PlayerAction } from "./strategy";

export type Phase = "betting" | "playerTurn" | "roundOver";

export type HandOutcome = "blackjack" | "win" | "push" | "lose" | "bust" | "surrender";

export interface PlayerHand {
  readonly cards: readonly Card[];
  /** Total wager on this hand, including any double. */
  readonly bet: number;
  readonly fromSplit: boolean;
  readonly isSplitAces: boolean;
  readonly doubled: boolean;
  readonly surrendered: boolean;
  /** No further actions possible on this hand. */
  readonly done: boolean;
  readonly outcome?: HandOutcome;
  /** Net win/loss in chips once settled. */
  readonly net?: number;
}

export interface Seat {
  readonly id: number;
  readonly kind: "human" | "ai";
  readonly name: string;
  readonly hands: readonly PlayerHand[];
  readonly bankroll: number;
}

export interface DealerState {
  readonly cards: readonly Card[];
  readonly holeRevealed: boolean;
}

export interface TurnPointer {
  readonly seat: number;
  readonly hand: number;
}

export type GameEvent =
  | { readonly type: "deal"; readonly card: Card; readonly to: "dealer" | "player"; readonly seat?: number; readonly hand?: number; readonly faceDown: boolean }
  | { readonly type: "reveal"; readonly card: Card }
  | { readonly type: "action"; readonly seat: number; readonly hand: number; readonly action: PlayerAction }
  | { readonly type: "bet"; readonly seat: number; readonly amount: number }
  | { readonly type: "shuffle"; readonly reason: ShuffleReason };

/**
 * - new-shoe / cut-card: normal shuffles.
 * - insufficient-cards: before a round, too few cards remained to complete it
 *   safely, so the shoe ended early (treated like reaching the cut card).
 * - exhausted: the shoe ran out mid-round and the discards were reshuffled
 *   to finish it. Counting data for that shoe is marked invalid.
 */
export type ShuffleReason = "new-shoe" | "cut-card" | "insufficient-cards" | "exhausted";

export interface CountState {
  /** Hi-Lo running count of every card exposed from the current pack. */
  readonly runningCount: number;
  readonly cardsSeen: number;
  /**
   * False once the shoe has been interrupted by a mid-round exhaustion
   * reshuffle: the count then describes a makeshift pack, and analytics must
   * not treat this shoe as a normal one. Reset to true at the next shuffle.
   */
  readonly valid: boolean;
}

export const FRESH_COUNT: CountState = Object.freeze({ runningCount: 0, cardsSeen: 0, valid: true });

export interface GameState {
  readonly rules: TableRules;
  readonly shoe: Shoe;
  readonly phase: Phase;
  readonly seats: readonly Seat[];
  readonly dealer: DealerState;
  readonly turn: TurnPointer | null;
  readonly roundNumber: number;
  readonly shoeNumber: number;
  readonly roundsThisShoe: number;
  /** Set once the cut card has come out; the next round starts with a fresh shoe. */
  readonly reshufflePending: boolean;
  /** Count and shoe position at the start of the current round (after any shuffle, before dealing). */
  readonly roundStart: { readonly count: CountState; readonly shoePosition: number };
  /**
   * If the shoe was exhausted mid-round, the original shoe (exact card
   * identities and order) as it stood when it ran out. Null otherwise.
   */
  readonly interruptedShoe: Shoe | null;
  readonly count: CountState;
  /** Events from the current round, in order. */
  readonly log: readonly GameEvent[];
}

export interface SeatConfig {
  kind: "human" | "ai";
  name: string;
  bankroll: number;
}

export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalActionError";
  }
}

// ---------------------------------------------------------------------------
// Internal mutable draft. Public functions clone state, mutate the draft and
// return it, which keeps the transition code readable while staying pure.

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface DraftHand extends Mutable<PlayerHand> {
  cards: Card[];
}
interface DraftSeat extends Omit<Mutable<Seat>, "hands"> {
  hands: DraftHand[];
}
interface Draft extends Omit<Mutable<GameState>, "seats" | "dealer" | "log" | "count"> {
  seats: DraftSeat[];
  dealer: { cards: Card[]; holeRevealed: boolean };
  log: GameEvent[];
  count: Mutable<CountState>;
}

function toDraft(s: GameState): Draft {
  return {
    ...s,
    seats: s.seats.map((seat) => ({ ...seat, hands: seat.hands.map((h) => ({ ...h, cards: [...h.cards] })) })),
    dealer: { cards: [...s.dealer.cards], holeRevealed: s.dealer.holeRevealed },
    log: [...s.log],
    count: { ...s.count },
  };
}

function expose(d: Draft, card: Card) {
  // Replace rather than mutate so snapshots (roundStart, FRESH_COUNT) are never aliased.
  d.count = { ...d.count, runningCount: d.count.runningCount + hiLoValue(card.rank), cardsSeen: d.count.cardsSeen + 1 };
}

export function isFromCurrentPack(shoe: Shoe, card: Card): boolean {
  for (let i = 0; i < shoe.position; i++) if (shoe.cards[i].id === card.id) return true;
  return false;
}

function cardsOnTable(d: Draft): Set<string> {
  const ids = new Set<string>();
  for (const c of d.dealer.cards) ids.add(c.id);
  for (const s of d.seats) for (const h of s.hands) for (const c of h.cards) ids.add(c.id);
  return ids;
}

/**
 * Draw the next card. If the shoe is physically exhausted mid-round (rare;
 * only with deep penetration and many split hands), the discards are
 * reshuffled into a temporary shoe, as a dealer would, and the cut card is
 * treated as reached so a full reshuffle happens before the next round.
 */
function draw(d: Draft, rng: Rng): Card {
  if (d.shoe.position >= d.shoe.cards.length) {
    const onTable = cardsOnTable(d);
    const discards = d.shoe.cards.filter((c) => !onTable.has(c.id));
    if (discards.length === 0) throw new Error("No cards available to continue the round.");
    d.interruptedShoe ??= d.shoe;
    d.shoe = { decks: d.shoe.decks, cards: shuffle(discards, rng), position: 0, cutCardIndex: 0 };
    d.count = { runningCount: 0, cardsSeen: 0, valid: false };
    d.reshufflePending = true;
    d.log.push({ type: "shuffle", reason: "exhausted" });
  }
  const card = d.shoe.cards[d.shoe.position];
  d.shoe = { ...d.shoe, position: d.shoe.position + 1 };
  return card;
}

function dealToHand(d: Draft, seat: number, hand: number, rng: Rng) {
  const card = draw(d, rng);
  d.seats[seat].hands[hand].cards.push(card);
  expose(d, card);
  d.log.push({ type: "deal", card, to: "player", seat, hand, faceDown: false });
}

function dealToDealer(d: Draft, faceDown: boolean, rng: Rng) {
  const card = draw(d, rng);
  d.dealer.cards.push(card);
  if (!faceDown) expose(d, card);
  d.log.push({ type: "deal", card, to: "dealer", faceDown });
}

function revealHole(d: Draft) {
  if (d.dealer.holeRevealed || d.dealer.cards.length < 2) return;
  d.dealer.holeRevealed = true;
  const hole = d.dealer.cards[1];
  // After an exhaustion reshuffle the hole card belongs to the previous pack
  // and must not be counted into the makeshift one.
  if (isFromCurrentPack(d.shoe, hole)) expose(d, hole);
  d.log.push({ type: "reveal", card: d.dealer.cards[1] });
}

// ---------------------------------------------------------------------------

export function createGame(rules: TableRules, seats: readonly SeatConfig[], rng: Rng): GameState {
  if (seats.length < 1 || seats.length > 7) throw new Error("A table has 1–7 seats.");
  if (seats.filter((s) => s.kind === "human").length > 1) throw new Error("Only one human player is supported.");
  return {
    rules,
    shoe: createShoe(rules.decks, rng, rules.penetration),
    phase: "betting",
    seats: seats.map((s, i) => ({ id: i, kind: s.kind, name: s.name, bankroll: s.bankroll, hands: [] })),
    dealer: { cards: [], holeRevealed: false },
    turn: null,
    roundNumber: 0,
    shoeNumber: 1,
    roundsThisShoe: 0,
    reshufflePending: false,
    roundStart: { count: FRESH_COUNT, shoePosition: 0 },
    interruptedShoe: null,
    count: FRESH_COUNT,
    log: [{ type: "shuffle", reason: "new-shoe" }],
  };
}

/**
 * Take bets and deal a round in casino order: one card to each seat from the
 * dealer's left, dealer upcard, second card to each seat, dealer hole card.
 * @param bets bet per seat id; seats without a positive bet sit out.
 */
export function startRound(state: GameState, bets: Readonly<Record<number, number>>, rng: Rng): GameState {
  if (state.phase === "playerTurn") throw new IllegalActionError("A round is already in progress.");
  const d = toDraft(state);
  const { minBet, maxBet } = d.rules;
  for (const seat of d.seats) {
    const bet = bets[seat.id] ?? 0;
    if (bet !== 0 && (bet < minBet || bet > maxBet)) {
      throw new IllegalActionError(`Bet for ${seat.name} must be between ${minBet} and ${maxBet}.`);
    }
    if (bet > seat.bankroll) throw new IllegalActionError(`${seat.name} cannot cover a bet of ${bet}.`);
  }
  const playing = d.seats.filter((s) => (bets[s.id] ?? 0) > 0);
  if (playing.length === 0) throw new IllegalActionError("At least one seat must bet.");

  d.log = [];
  if (d.reshufflePending) newShoe(d, rng, "cut-card");
  else if (cardsRemaining(d.shoe) < minimumCardsForRound(playing.length)) newShoe(d, rng, "insufficient-cards");
  d.roundStart = { count: { ...d.count }, shoePosition: d.shoe.position };
  for (const seat of playing) d.log.push({ type: "bet", seat: seat.id, amount: bets[seat.id] });

  d.roundNumber++;
  d.roundsThisShoe++;
  d.dealer = { cards: [], holeRevealed: false };
  for (const seat of d.seats) {
    const bet = bets[seat.id] ?? 0;
    seat.hands = bet > 0 ? [newHand(bet, false, false)] : [];
  }

  for (let round = 0; round < 2; round++) {
    for (const seat of playing) dealToHand(d, seat.id, 0, rng);
    dealToDealer(d, round === 1, rng);
  }

  const dealerBJ = isBlackjack(d.dealer.cards);
  const up = pointRank(d.dealer.cards[0].rank);
  if (dealerBJ && (up === 1 || up === 10)) {
    // Dealer peeks and has a natural: round ends immediately.
    revealHole(d);
    for (const seat of playing) seat.hands[0].done = true;
    settle(d);
    return finishRound(d);
  }

  for (const seat of playing) {
    const h = seat.hands[0];
    if (isBlackjack(h.cards)) h.done = true;
  }

  d.phase = "playerTurn";
  d.turn = null;
  advanceTurn(d, rng);
  return d as GameState;
}

/**
 * Cards a round must be able to draw before it starts. Generous enough that
 * mid-round exhaustion only happens with extreme splitting and hitting.
 */
export function minimumCardsForRound(playingSeats: number): number {
  return 4 * (playingSeats + 1);
}

function newShoe(d: Draft, rng: Rng, reason: ShuffleReason) {
  d.shoe = createShoe(d.rules.decks, rng, d.rules.penetration);
  d.count = { ...FRESH_COUNT };
  d.interruptedShoe = null;
  d.shoeNumber++;
  d.roundsThisShoe = 0;
  d.reshufflePending = false;
  d.log.push({ type: "shuffle", reason });
}

function newHand(bet: number, fromSplit: boolean, isSplitAces: boolean): DraftHand {
  return { cards: [], bet, fromSplit, isSplitAces, doubled: false, surrendered: false, done: false };
}

export function currentHand(state: GameState): PlayerHand | null {
  if (!state.turn) return null;
  return state.seats[state.turn.seat].hands[state.turn.hand];
}

export function availableActions(state: GameState): PlayerAction[] {
  if (state.phase !== "playerTurn" || !state.turn) return [];
  const seat = state.seats[state.turn.seat];
  const hand = seat.hands[state.turn.hand];
  // Doubling and splitting need chips to cover the extra wager.
  const committed = seat.hands.reduce((sum, h) => sum + h.bet, 0);
  const canCover = seat.bankroll - committed >= hand.bet;
  return handActions(state.rules, hand, seat.hands.length).filter((a) => canCover || (a !== "double" && a !== "split"));
}

/** Add chips to a seat between rounds (a buy-in). */
export function buyIn(state: GameState, seatId: number, amount: number): GameState {
  if (state.phase === "playerTurn") throw new IllegalActionError("Cannot buy in during a round.");
  if (!(amount > 0)) throw new IllegalActionError("Buy-in must be positive.");
  return { ...state, seats: state.seats.map((s) => (s.id === seatId ? { ...s, bankroll: s.bankroll + amount } : s)) };
}

export function handActions(rules: TableRules, hand: PlayerHand, handsHeld: number): PlayerAction[] {
  if (hand.done) return [];
  const v = handValue(hand.cards);
  const actions: PlayerAction[] = [];
  const twoCards = hand.cards.length === 2;
  const splitAcesLocked = hand.isSplitAces && !rules.hitSplitAces;

  if (!splitAcesLocked) actions.push("hit");
  actions.push("stand");
  if (twoCards && !splitAcesLocked && canDoubleTotal(rules, v.total, v.soft) && (!hand.fromSplit || rules.doubleAfterSplit)) {
    actions.push("double");
  }
  if (twoCards && isPair(hand.cards) && handsHeld < rules.maxSplitHands) {
    const aces = pointRank(hand.cards[0].rank) === 1;
    if (!aces || !hand.fromSplit || rules.resplitAces) actions.push("split");
  }
  if (twoCards && !hand.fromSplit && handsHeld === 1 && rules.surrender === "late") actions.push("surrender");
  return actions;
}

export function act(state: GameState, action: PlayerAction, rng: Rng): GameState {
  const legal = availableActions(state);
  if (!legal.includes(action)) throw new IllegalActionError(`Action "${action}" is not available.`);
  const d = toDraft(state);
  const { seat: si, hand: hi } = d.turn!;
  const seat = d.seats[si];
  const hand = seat.hands[hi];
  d.log.push({ type: "action", seat: si, hand: hi, action });

  switch (action) {
    case "hit": {
      dealToHand(d, si, hi, rng);
      if (handValue(hand.cards).total >= 21) hand.done = true;
      break;
    }
    case "stand":
      hand.done = true;
      break;
    case "double": {
      hand.bet *= 2;
      hand.doubled = true;
      dealToHand(d, si, hi, rng);
      hand.done = true;
      break;
    }
    case "surrender":
      hand.surrendered = true;
      hand.done = true;
      break;
    case "split": {
      const aces = pointRank(hand.cards[0].rank) === 1;
      const second = hand.cards.pop()!;
      hand.fromSplit = true;
      hand.isSplitAces = aces;
      const sibling = newHand(hand.bet, true, aces);
      sibling.cards.push(second);
      seat.hands.splice(hi + 1, 0, sibling);
      // The current hand receives its second card now; the sibling gets its
      // second card when play reaches it.
      dealToHand(d, si, hi, rng);
      settleSplitHandIfLocked(d, si, hi);
      break;
    }
  }
  advanceTurn(d, rng);
  return d as GameState;
}

/** After a split hand receives its second card, close it if no actions remain. */
function settleSplitHandIfLocked(d: Draft, si: number, hi: number) {
  const seat = d.seats[si];
  const hand = seat.hands[hi];
  if (handValue(hand.cards).total >= 21) {
    hand.done = true;
    return;
  }
  if (hand.isSplitAces && !d.rules.hitSplitAces) {
    const canResplit = handActions(d.rules, hand, seat.hands.length).includes("split");
    if (!canResplit) hand.done = true;
  }
}

/** Move the turn pointer to the next hand needing action, dealing split second cards as reached. */
function advanceTurn(d: Draft, rng: Rng) {
  const start = d.turn ?? { seat: 0, hand: 0 };
  for (let si = start.seat; si < d.seats.length; si++) {
    const seat = d.seats[si];
    for (let hi = si === start.seat ? start.hand : 0; hi < seat.hands.length; hi++) {
      const hand = seat.hands[hi];
      if (hand.done) continue;
      if (hand.cards.length === 1) {
        dealToHand(d, si, hi, rng);
        settleSplitHandIfLocked(d, si, hi);
        if (hand.done) continue;
      }
      d.turn = { seat: si, hand: hi };
      return;
    }
  }
  d.turn = null;
  playDealer(d, rng);
}

function playDealer(d: Draft, rng: Rng) {
  revealHole(d);
  const live = d.seats.some((s) =>
    s.hands.some((h) => !h.surrendered && !handValue(h.cards).busted && !isBlackjack(h.cards, h.fromSplit)),
  );
  if (live) {
    while (dealerShouldHit(d.dealer.cards, d.rules)) dealToDealer(d, false, rng);
  }
  settle(d);
  finishRound(d);
}

function settle(d: Draft) {
  const dealerCards = d.dealer.cards;
  const dealerBJ = isBlackjack(dealerCards);
  const dv = handValue(dealerCards);
  for (const seat of d.seats) {
    for (const h of seat.hands) {
      const v = handValue(h.cards);
      const natural = isBlackjack(h.cards, h.fromSplit);
      let outcome: HandOutcome;
      let net: number;
      if (h.surrendered) {
        outcome = "surrender";
        net = -h.bet / 2;
      } else if (natural) {
        outcome = dealerBJ ? "push" : "blackjack";
        net = dealerBJ ? 0 : h.bet * naturalPayout(d.rules, h.cards);
      } else if (dealerBJ) {
        outcome = "lose";
        net = -h.bet;
      } else if (v.busted) {
        outcome = "bust";
        net = -h.bet;
      } else if (dv.busted || v.total > dv.total) {
        outcome = "win";
        net = h.bet;
      } else if (v.total === dv.total) {
        outcome = "push";
        net = 0;
      } else {
        outcome = "lose";
        net = -h.bet;
      }
      h.outcome = outcome;
      h.net = net;
      h.done = true;
      seat.bankroll += net;
    }
  }
}

function finishRound(d: Draft): GameState {
  d.phase = "roundOver";
  d.turn = null;
  if (cutCardReached(d.shoe)) d.reshufflePending = true;
  return d as GameState;
}

// ---------------------------------------------------------------------------
// AI players follow verified basic strategy for the table rules.

export function basicStrategyAction(state: GameState): PlayerAction {
  const hand = currentHand(state);
  if (!hand) throw new IllegalActionError("No hand to act on.");
  const available = availableActions(state);
  const table = strategyTableFor(state.rules);
  const advice = evaluateDecision(table, state.rules, {
    cards: hand.cards.map((c) => pointRank(c.rank)) as PointRank[],
    up: pointRank(state.dealer.cards[0].rank),
    available,
  });
  return advice.best;
}

export function isHumanTurn(state: GameState): boolean {
  return state.turn !== null && state.seats[state.turn.seat].kind === "human";
}

/** Let AI seats act until it is the human's turn or the round is over. */
export function runAiTurns(state: GameState, rng: Rng): GameState {
  let s = state;
  while (s.phase === "playerTurn" && s.turn && !isHumanTurn(s)) s = act(s, basicStrategyAction(s), rng);
  return s;
}

/** Cards currently visible to a player at the table (hole card hidden until revealed). */
export function visibleCards(state: GameState): Card[] {
  const out: Card[] = [];
  state.dealer.cards.forEach((c, i) => {
    if (i !== 1 || state.dealer.holeRevealed) out.push(c);
  });
  for (const s of state.seats) for (const h of s.hands) out.push(...h.cards);
  return out;
}

/** Replace the shoe (tests and scripted scenarios only). */
export function withShoe(state: GameState, shoe: Shoe): GameState {
  return { ...state, shoe, count: FRESH_COUNT, roundStart: { count: FRESH_COUNT, shoePosition: 0 }, interruptedShoe: null, reshufflePending: false };
}
