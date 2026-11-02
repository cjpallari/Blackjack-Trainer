import { createDeck, type Card } from "./cards";
import { shuffle, type Rng } from "./rng";

/**
 * A finite shoe dealt without replacement. Immutable: drawing returns a new
 * Shoe. `cards` is the full shuffled order; `position` is the next card.
 */
export interface Shoe {
  readonly decks: number;
  readonly cards: readonly Card[];
  readonly position: number;
  /** Index at which the cut card sits. Once `position >= cutCardIndex`, the cut card is out. */
  readonly cutCardIndex: number;
}

export class ShoeExhaustedError extends Error {
  constructor() {
    super("The shoe has no cards left to deal.");
    this.name = "ShoeExhaustedError";
  }
}

export function buildCards(decks: number): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) cards.push(...createDeck(d));
  return cards;
}

/**
 * @param penetration fraction of the shoe dealt before the cut card (0 < p <= 1).
 */
export function createShoe(decks: number, rng: Rng, penetration = 1): Shoe {
  if (!Number.isInteger(decks) || decks < 1) throw new Error(`Invalid deck count: ${decks}`);
  if (!(penetration > 0 && penetration <= 1)) throw new Error(`Invalid penetration: ${penetration}`);
  const cards = shuffle(buildCards(decks), rng);
  return { decks, cards, position: 0, cutCardIndex: Math.round(cards.length * penetration) };
}

export function cardsRemaining(shoe: Shoe): number {
  return shoe.cards.length - shoe.position;
}

export function cardsDealt(shoe: Shoe): number {
  return shoe.position;
}

export function decksRemaining(shoe: Shoe): number {
  return cardsRemaining(shoe) / 52;
}

export function penetrationDealt(shoe: Shoe): number {
  return shoe.position / shoe.cards.length;
}

export function cutCardReached(shoe: Shoe): boolean {
  return shoe.position >= shoe.cutCardIndex;
}

export function drawCard(shoe: Shoe): { card: Card; shoe: Shoe } {
  if (shoe.position >= shoe.cards.length) throw new ShoeExhaustedError();
  return { card: shoe.cards[shoe.position], shoe: { ...shoe, position: shoe.position + 1 } };
}

export function drawCards(shoe: Shoe, n: number): { cards: Card[]; shoe: Shoe } {
  if (n > cardsRemaining(shoe)) throw new ShoeExhaustedError();
  return {
    cards: shoe.cards.slice(shoe.position, shoe.position + n),
    shoe: { ...shoe, position: shoe.position + n },
  };
}

/** Cards already dealt (the discard tray plus cards on the table). */
export function dealtCards(shoe: Shoe): readonly Card[] {
  return shoe.cards.slice(0, shoe.position);
}

/**
 * Build a shoe whose first cards have the given ranks (taken from a real
 * multi-deck composition, so no impossible shoes), followed by the remaining
 * cards in `rng` order. Used for deterministic tests and scripted drills.
 */
export function stackedShoe(decks: number, topRanks: readonly Card["rank"][], rng: Rng, penetration = 1): Shoe {
  const pool = shuffle(buildCards(decks), rng);
  const top: Card[] = [];
  for (const rank of topRanks) {
    const idx = pool.findIndex((c) => c.rank === rank);
    if (idx < 0) throw new Error(`Not enough ${rank}s in a ${decks}-deck shoe`);
    top.push(pool.splice(idx, 1)[0]);
  }
  const cards = [...top, ...pool];
  return { decks, cards, position: 0, cutCardIndex: Math.round(cards.length * penetration) };
}
