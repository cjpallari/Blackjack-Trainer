import { pointRank, type Card, type PointRank } from "./cards";

export interface HandValue {
  /** Best total not exceeding 21 if possible, otherwise the hard total. */
  readonly total: number;
  /** True when an ace is being counted as 11. */
  readonly soft: boolean;
  readonly busted: boolean;
}

export function handValueFromRanks(ranks: readonly PointRank[]): HandValue {
  let hard = 0;
  let aces = 0;
  for (const r of ranks) {
    hard += r;
    if (r === 1) aces++;
  }
  const soft = aces > 0 && hard + 10 <= 21;
  const total = soft ? hard + 10 : hard;
  return { total, soft, busted: total > 21 };
}

export function handValue(cards: readonly Card[]): HandValue {
  return handValueFromRanks(cards.map((c) => pointRank(c.rank)));
}

/**
 * A natural: exactly two cards totalling 21, not formed from a split.
 * Split hands that reach 21 on two cards are ordinary 21s.
 */
export function isBlackjack(cards: readonly Card[], fromSplit = false): boolean {
  if (fromSplit || cards.length !== 2) return false;
  const a = pointRank(cards[0].rank);
  const b = pointRank(cards[1].rank);
  return (a === 1 && b === 10) || (a === 10 && b === 1);
}

/** Two cards of equal point value (e.g. K-10 counts as a pair of tens). */
export function isPair(cards: readonly Card[]): boolean {
  return cards.length === 2 && pointRank(cards[0].rank) === pointRank(cards[1].rank);
}

export function describeHand(cards: readonly Card[]): string {
  const v = handValue(cards);
  if (isPair(cards)) {
    const r = pointRank(cards[0].rank);
    const label = r === 1 ? "A" : String(r);
    return `Pair of ${label}s`;
  }
  if (v.busted) return `Bust (${v.total})`;
  return `${v.soft ? "Soft" : "Hard"} ${v.total}`;
}
