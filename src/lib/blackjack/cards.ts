export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export type Rank = (typeof RANKS)[number];

/**
 * Point rank used by strategy and analysis code: 1 = Ace, 2..9 face value,
 * 10 = any ten-value card (10, J, Q, K).
 */
export type PointRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export const POINT_RANKS: readonly PointRank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
  /** Which physical deck in the shoe this card came from (0-based). */
  readonly deck: number;
  /** Unique within a shoe: `${deck}-${rank}${suit[0]}`. */
  readonly id: string;
}

export function makeCard(rank: Rank, suit: Suit, deck = 0): Card {
  return { rank, suit, deck, id: `${deck}-${rank}${suit[0]}` };
}

export function pointRank(rank: Rank): PointRank {
  switch (rank) {
    case "A":
      return 1;
    case "10":
    case "J":
    case "Q":
    case "K":
      return 10;
    default:
      return Number(rank) as PointRank;
  }
}

export function isRed(suit: Suit): boolean {
  return suit === "hearts" || suit === "diamonds";
}

export const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

export function cardLabel(card: Pick<Card, "rank" | "suit">): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

export function pointRankLabel(r: PointRank): string {
  return r === 1 ? "A" : r === 10 ? "10" : String(r);
}

/** One standard 52-card deck in a fixed order. */
export function createDeck(deck = 0): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) cards.push(makeCard(rank, suit, deck));
  }
  return cards;
}
