import type { Card } from "../blackjack/cards";
import { runningCount } from "../blackjack/counting";
import type { Rng } from "../blackjack/rng";
import { createShoe, drawCards } from "../blackjack/shoe";

export type RCDrillType = "flashcard" | "sequence" | "deck" | "doubleDeck" | "simultaneous" | "timed";

export const RC_DRILL_LABELS: Record<RCDrillType, string> = {
  flashcard: "Flashcards",
  sequence: "Card sequence",
  deck: "Deck countdown",
  doubleDeck: "Double-deck countdown",
  simultaneous: "Simultaneous cards",
  timed: "Timed drill",
};

export interface RCConfig {
  type: RCDrillType;
  /** Cards per sequence drill. */
  sequenceLength: number;
  /** Cards shown at once in simultaneous mode. */
  groupSize: number;
  /** Milliseconds each card (or group) stays visible when auto-advancing. */
  speedMs: number;
  /** Manual: press a key to reveal the next card (time is still recorded). */
  pacing: "auto" | "manual";
  /** Countdowns only: cards removed unseen first, so the answer is not always 0. */
  hiddenCards: number;
  /** Timed drill length in seconds. */
  timedSeconds: number;
  /** Shoe size for sequence, simultaneous, timed and flashcard drills. */
  decks: number;
}

export const DEFAULT_RC_CONFIG: RCConfig = {
  type: "sequence",
  sequenceLength: 12,
  groupSize: 3,
  speedMs: 900,
  pacing: "auto",
  hiddenCards: 0,
  timedSeconds: 30,
  decks: 6,
};

export interface RCDrill {
  readonly type: RCDrillType;
  /** Cards in display order, grouped by what is revealed together. */
  readonly groups: readonly (readonly Card[])[];
  /** Countdowns: cards removed unseen before the countdown starts. */
  readonly hidden: readonly Card[];
}

/**
 * Build a drill from a real shuffled shoe (dealt without replacement), so
 * every sequence is a possible sequence from an actual shoe.
 */
export function createDrill(config: RCConfig, rng: Rng): RCDrill {
  switch (config.type) {
    case "deck":
    case "doubleDeck": {
      const decks = config.type === "deck" ? 1 : 2;
      const shoe = createShoe(decks, rng);
      const hiddenN = Math.max(0, Math.min(config.hiddenCards, 10));
      const hidden = shoe.cards.slice(0, hiddenN);
      const shown = shoe.cards.slice(hiddenN);
      return { type: config.type, groups: shown.map((c) => [c]), hidden };
    }
    case "simultaneous": {
      const size = Math.max(2, Math.min(config.groupSize, 7));
      const { cards } = drawCards(createShoe(config.decks, rng), Math.min(size * Math.max(1, Math.round(config.sequenceLength / size)), 52 * config.decks));
      const groups: Card[][] = [];
      for (let i = 0; i < cards.length; i += size) groups.push(cards.slice(i, i + size));
      return { type: config.type, groups, hidden: [] };
    }
    case "timed": {
      // Enough cards for the whole duration; the answer is the count of cards actually shown.
      const needed = Math.ceil((config.timedSeconds * 1000) / Math.max(150, config.speedMs)) + 1;
      const { cards } = drawCards(createShoe(config.decks, rng), Math.min(needed, 52 * config.decks));
      return { type: config.type, groups: cards.map((c) => [c]), hidden: [] };
    }
    case "flashcard":
    case "sequence": {
      const n = config.type === "flashcard" ? 52 : Math.max(2, Math.min(config.sequenceLength, 104));
      const { cards } = drawCards(createShoe(config.decks, rng), n);
      return { type: config.type, groups: cards.map((c) => [c]), hidden: [] };
    }
  }
}

/** Expected running count after the first `groupsShown` groups. */
export function expectedCount(drill: RCDrill, groupsShown = drill.groups.length): number {
  return runningCount(drill.groups.slice(0, groupsShown).flat());
}

export function cardsShown(drill: RCDrill, groupsShown = drill.groups.length): number {
  return drill.groups.slice(0, groupsShown).reduce((n, g) => n + g.length, 0);
}
