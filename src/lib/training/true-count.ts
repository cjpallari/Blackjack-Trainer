import { runningCount, trueCount, type TrueCountRounding } from "../blackjack/counting";
import { randomInt, type Rng } from "../blackjack/rng";
import { createShoe } from "../blackjack/shoe";

export type TCMode = "calculate" | "estimate";
export const TC_DECK_OPTIONS = [1, 2, 4, 6, 8] as const;

export interface TCScenario {
  readonly decks: number;
  readonly cardsDealt: number;
  readonly runningCount: number;
  /** Actual remaining cards in the shoe. */
  readonly cardsRemaining: number;
  /** Remaining decks rounded to the nearest quarter deck, as given in calculate mode. */
  readonly decksRemainingQuarter: number;
}

/**
 * A real shoe state: shuffle a shoe, deal a random number of cards between
 * ~10% and ~85% penetration, and take the Hi-Lo count of the dealt cards.
 * The running count is therefore always one that can occur at that depth.
 */
export function generateTCScenario(decks: number, rng: Rng, opts: { avoidZero?: boolean } = {}): TCScenario {
  for (;;) {
    const shoe = createShoe(decks, rng);
    const total = shoe.cards.length;
    const minDealt = Math.max(13, Math.round(total * 0.1));
    const maxDealt = Math.round(total * 0.85);
    const dealt = minDealt + randomInt(rng, maxDealt - minDealt + 1);
    const rc = runningCount(shoe.cards.slice(0, dealt));
    if (opts.avoidZero && rc === 0) continue;
    const remaining = total - dealt;
    const quarter = Math.max(0.25, Math.round((remaining / 52) * 4) / 4);
    return { decks, cardsDealt: dealt, runningCount: rc, cardsRemaining: remaining, decksRemainingQuarter: quarter };
  }
}

export function expectedTrueCount(s: TCScenario, rounding: TrueCountRounding): number {
  return trueCount(s.runningCount, s.decksRemainingQuarter, rounding);
}

export interface TCGrade {
  readonly tcCorrect: boolean;
  readonly expectedTc: number;
  /** Estimate mode: the user's deck estimate vs the actual quarter-deck value. */
  readonly deckError?: number;
  readonly deckCorrect?: boolean;
  /** Estimate mode: TC computed from the user's own deck estimate (isolates arithmetic errors). */
  readonly tcFromOwnEstimate?: number;
  readonly calculationCorrect?: boolean;
}

/** Deck estimates within half a deck count as correct (a quarter for 1–2 deck games). */
export function deckTolerance(decks: number): number {
  return decks <= 2 ? 0.25 : 0.5;
}

export function gradeCalculate(s: TCScenario, answer: number, rounding: TrueCountRounding): TCGrade {
  const expectedTc = expectedTrueCount(s, rounding);
  return { tcCorrect: Math.abs(answer - expectedTc) < 1e-9, expectedTc };
}

export function gradeEstimate(s: TCScenario, deckEstimate: number, tcAnswer: number, rounding: TrueCountRounding): TCGrade {
  const expectedTc = expectedTrueCount(s, rounding);
  const deckError = deckEstimate - s.cardsRemaining / 52;
  const deckCorrect = Math.abs(deckError) <= deckTolerance(s.decks) + 1e-9;
  const tcFromOwnEstimate = deckEstimate > 0 ? trueCount(s.runningCount, deckEstimate, rounding) : NaN;
  return {
    expectedTc,
    tcCorrect: Math.abs(tcAnswer - expectedTc) < 1e-9,
    deckError,
    deckCorrect,
    tcFromOwnEstimate,
    calculationCorrect: Math.abs(tcAnswer - tcFromOwnEstimate) < 1e-9,
  };
}
