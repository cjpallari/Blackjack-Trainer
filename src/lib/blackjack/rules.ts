import type { Card } from "./cards";

export const DECK_OPTIONS = [1, 2, 4, 6, 8] as const;
export type DeckCount = (typeof DECK_OPTIONS)[number];

/** Which two-card totals may be doubled. */
export type DoubleRestriction = "any2" | "9-11" | "10-11";

/** Late surrender only (after the dealer checks for blackjack). Early surrender is not modelled. */
export type SurrenderRule = "none" | "late";

/**
 * Rule variants. Only "standard" is implemented. Non-standard games (e.g. the
 * Blackjack Elite game at El Dorado Hills, with a suited A-K bonus and hard-31
 * behaviour) must be added here as a new variant only after their official
 * rules and a verified strategy are available; see `naturalPayout` and
 * `strategyTableFor` for the extension points.
 */
export type RulesVariant = "standard";

export interface TableRules {
  readonly variant: RulesVariant;
  readonly decks: DeckCount;
  readonly dealerHitsSoft17: boolean;
  readonly blackjackPayout: "3:2" | "6:5";
  readonly doubleAfterSplit: boolean;
  readonly doubleRestriction: DoubleRestriction;
  readonly surrender: SurrenderRule;
  /** Total hands a player may hold after splitting (2 = no resplits). */
  readonly maxSplitHands: 2 | 3 | 4;
  readonly resplitAces: boolean;
  /** When false, each split ace receives exactly one card. */
  readonly hitSplitAces: boolean;
  /**
   * US-style hole card: the dealer checks for blackjack with an ace or
   * ten-value upcard before players act. No-hole-card (ENHC) games are not
   * supported, so this is fixed at true.
   */
  readonly dealerPeeks: true;
  /** Fraction of the shoe dealt before the cut card. */
  readonly penetration: number;
  readonly aiPlayers: number;
  readonly minBet: number;
  readonly maxBet: number;
}

/**
 * Conventional double-deck practice game. Not a model of any specific casino.
 */
export const DEFAULT_RULES: TableRules = {
  variant: "standard",
  decks: 2,
  dealerHitsSoft17: true,
  blackjackPayout: "3:2",
  doubleAfterSplit: true,
  doubleRestriction: "any2",
  surrender: "none",
  maxSplitHands: 4,
  resplitAces: false,
  hitSplitAces: false,
  dealerPeeks: true,
  penetration: 0.7,
  aiPlayers: 2,
  minBet: 10,
  maxBet: 500,
};

export const RULE_PRESETS: { id: string; name: string; description: string; rules: TableRules }[] = [
  {
    id: "double-deck-practice",
    name: "Double-deck practice",
    description: "2 decks, H17, 3:2, DAS, ~70% penetration. A conventional practice game.",
    rules: DEFAULT_RULES,
  },
  {
    id: "six-deck-s17",
    name: "Six-deck shoe (S17)",
    description: "6 decks, S17, 3:2, DAS, late surrender, 75% penetration.",
    rules: { ...DEFAULT_RULES, decks: 6, dealerHitsSoft17: false, surrender: "late", penetration: 0.75 },
  },
  {
    id: "six-deck-h17",
    name: "Six-deck shoe (H17)",
    description: "6 decks, H17, 3:2, DAS, late surrender, 75% penetration.",
    rules: { ...DEFAULT_RULES, decks: 6, surrender: "late", penetration: 0.75 },
  },
  {
    id: "single-deck",
    name: "Single deck",
    description: "1 deck, H17, 3:2, no DAS, double any two, ~60% penetration.",
    rules: { ...DEFAULT_RULES, decks: 1, doubleAfterSplit: false, maxSplitHands: 2, penetration: 0.6, aiPlayers: 1 },
  },
];

export function validateRules(rules: TableRules): string[] {
  const errors: string[] = [];
  if (!DECK_OPTIONS.includes(rules.decks)) errors.push("Deck count must be 1, 2, 4, 6 or 8.");
  if (!(rules.penetration >= 0.4 && rules.penetration <= 0.95))
    errors.push("Penetration must be between 40% and 95%.");
  if (rules.aiPlayers < 0 || rules.aiPlayers > 6) errors.push("AI players must be between 0 and 6.");
  if (rules.minBet <= 0 || rules.maxBet < rules.minBet) errors.push("Bet limits are invalid.");
  return errors;
}

/** Payout multiple for a player natural (bet × multiple, returned on top of the stake). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- variant hook, see comment
export function naturalPayout(rules: TableRules, _cards: readonly Card[]): number {
  // Variant hook: a future suited-A-K bonus would inspect `_cards` here.
  return rules.blackjackPayout === "3:2" ? 1.5 : 1.2;
}

export function canDoubleTotal(rules: TableRules, total: number, soft: boolean): boolean {
  switch (rules.doubleRestriction) {
    case "any2":
      return true;
    case "9-11":
      return !soft && total >= 9 && total <= 11;
    case "10-11":
      return !soft && total >= 10 && total <= 11;
  }
}

export function describeRules(r: TableRules): string {
  const parts = [
    `${r.decks} deck${r.decks > 1 ? "s" : ""}`,
    r.dealerHitsSoft17 ? "H17" : "S17",
    `BJ ${r.blackjackPayout}`,
    r.doubleAfterSplit ? "DAS" : "no DAS",
    r.doubleRestriction === "any2" ? "D any 2" : `D ${r.doubleRestriction}`,
    r.surrender === "late" ? "LS" : "no surrender",
  ];
  return parts.join(" · ");
}
