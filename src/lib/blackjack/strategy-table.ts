import type { PointRank } from "./cards";

/** EVs per unit bet, conditional on the dealer not holding a natural. */
export interface ActionEVs {
  readonly stand: number;
  readonly hit: number;
  readonly double: number;
  /** Present on pair cells only. */
  readonly splitDAS?: number;
  readonly splitNoDAS?: number;
}

/** Keyed by dealer upcard point rank ("1" = Ace ... "10"). */
export type UpcardRow = Readonly<Record<string, ActionEVs>>;

export interface StrategyTable {
  readonly id: string;
  readonly decks: number;
  readonly dealerHitsSoft17: boolean;
  readonly method: string;
  /** Hard totals 4..20 from two-card compositions (4 = 2-2 and 20 = 10-10 unsplit). */
  readonly hard: Readonly<Record<string, UpcardRow>>;
  /** Soft totals 12..20 (12 = A-A unsplit). */
  readonly soft: Readonly<Record<string, UpcardRow>>;
  /** Pairs by point rank, with the pair's own stand/hit/double EVs and split EVs. */
  readonly pairs: Readonly<Record<string, UpcardRow>>;
}

export function strategyTableId(decks: number, dealerHitsSoft17: boolean): string {
  return `${decks}D-${dealerHitsSoft17 ? "H17" : "S17"}`;
}

export function upKey(up: PointRank): string {
  return String(up);
}
