/**
 * Count checkpoints at the table: what the correct answers are at a moment,
 * how an answer is graded, and when random checkpoints fire.
 *
 * "Actual" values come from the table view, so they reflect only cards the
 * player has seen: an unrevealed hole card is never part of the count.
 * Decks remaining are the undealt cards in the shoe (including those behind
 * the cut card), which is the standard Hi-Lo true-count denominator.
 */
import { trueCount, type TrueCountRounding } from "../../blackjack/counting";
import type { Rng } from "../../blackjack/rng";
import type { TableView } from "../../blackjack/table-view";
import { deckTolerance } from "../true-count";

export type CheckpointTrigger = "manual" | "random" | "scheduled" | "end-of-shoe";

export interface CheckpointConfig {
  /** 0 = no automatic checks; otherwise roughly every N completed rounds. */
  every: number;
  /** Random (≈1 in N rounds) instead of exactly every N rounds. */
  random: boolean;
  askTrueCount: boolean;
  askDecks: boolean;
  /** Ask for the final running count when the shoe ends. */
  endOfShoe: boolean;
  /** Show the exact number of undealt cards in the deck-estimation question. */
  deckAssist: boolean;
}

export const DEFAULT_CHECKPOINTS: CheckpointConfig = {
  every: 5,
  random: true,
  askTrueCount: true,
  askDecks: false,
  endOfShoe: true,
  deckAssist: false,
};

export interface CheckpointActual {
  readonly runningCount: number;
  readonly cardsRemaining: number;
  readonly decksRemaining: number;
  /** Decks remaining to the nearest quarter deck, the precision a player is expected to use. */
  readonly decksQuarter: number;
  /** True count using the quarter-deck estimate and the configured rounding. null if no cards remain. */
  readonly trueCount: number | null;
  /** Unrounded true count using exact decks remaining. */
  readonly trueCountRaw: number | null;
  readonly cardsDealt: number;
  readonly valid: boolean;
}

export function quarterDeckEstimate(cards: number): number {
  return Math.max(0.25, Math.round((cards / 52) * 4) / 4);
}

export function actualFromView(view: TableView, rounding: TrueCountRounding): CheckpointActual {
  const rc = view.count.runningCount;
  const cards = view.shoe.cardsInShoe;
  const dq = quarterDeckEstimate(cards);
  return {
    runningCount: rc,
    cardsRemaining: cards,
    decksRemaining: cards / 52,
    decksQuarter: dq,
    trueCount: cards > 0 ? trueCount(rc, dq, rounding) : null,
    trueCountRaw: cards > 0 ? rc / (cards / 52) : null,
    cardsDealt: view.shoe.totalCards - cards,
    valid: view.count.valid,
  };
}

export interface CheckpointAnswer {
  readonly runningCount: number | null;
  readonly trueCount?: number | null;
  readonly decks?: number | null;
}

export interface CheckpointGrade {
  readonly answered: boolean;
  readonly rcCorrect: boolean;
  /** answer − actual; null if not answered. */
  readonly rcError: number | null;
  readonly tcAsked: boolean;
  readonly tcCorrect: boolean | null;
  readonly tcError: number | null;
  readonly decksAsked: boolean;
  readonly deckCorrect: boolean | null;
  readonly deckError: number | null;
  /** TC computed from the player's own RC and deck estimate, vs their TC answer (arithmetic only). */
  readonly arithmeticCorrect: boolean | null;
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

export function gradeCheckpoint(
  actual: CheckpointActual,
  answer: CheckpointAnswer,
  opts: { rounding: TrueCountRounding; askTrueCount: boolean; askDecks: boolean; decks: number },
): CheckpointGrade {
  const rc = answer.runningCount;
  const answered = rc !== null && Number.isFinite(rc);
  const tcAsked = opts.askTrueCount && actual.trueCount !== null;
  const tc = tcAsked ? (answer.trueCount ?? null) : null;
  const decksAsked = opts.askDecks;
  const d = decksAsked ? (answer.decks ?? null) : null;

  const tcCorrect = tcAsked ? tc !== null && same(tc, actual.trueCount!) : null;
  const deckError = d !== null ? d - actual.decksRemaining : null;
  const deckCorrect = decksAsked ? deckError !== null && Math.abs(deckError) <= deckTolerance(opts.decks) + 1e-9 : null;
  const arithmeticCorrect =
    tcAsked && decksAsked && answered && tc !== null && d !== null && d > 0 ? same(trueCount(rc!, d, opts.rounding), tc) : null;

  return {
    answered,
    rcCorrect: answered && rc === actual.runningCount,
    rcError: answered ? rc! - actual.runningCount : null,
    tcAsked,
    tcCorrect,
    tcError: tcAsked && tc !== null ? tc - actual.trueCount! : null,
    decksAsked,
    deckCorrect,
    deckError,
    arithmeticCorrect,
  };
}

/** Whether an automatic checkpoint fires after a completed round. */
export function shouldCheckpoint(cfg: CheckpointConfig, roundsSinceLastCheck: number, rng: Rng): boolean {
  if (cfg.every <= 0) return false;
  if (!cfg.random) return roundsSinceLastCheck >= cfg.every;
  if (roundsSinceLastCheck < 1) return false;
  return rng() < 1 / cfg.every;
}
