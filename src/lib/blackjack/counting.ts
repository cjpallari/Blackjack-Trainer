import { pointRank, type Card, type Rank } from "./cards";

/** Hi-Lo tag: 2–6 = +1, 7–9 = 0, 10/J/Q/K/A = −1. */
export function hiLoValue(rank: Rank): -1 | 0 | 1 {
  const r = pointRank(rank);
  if (r >= 2 && r <= 6) return 1;
  if (r >= 7 && r <= 9) return 0;
  return -1;
}

export function runningCount(cards: readonly Pick<Card, "rank">[]): number {
  let rc = 0;
  for (const c of cards) rc += hiLoValue(c.rank);
  return rc;
}

/**
 * Rounding conventions for converting a raw true count to an integer:
 * - truncate: toward zero (the most common Hi-Lo convention; +2.9 → +2, −2.9 → −2)
 * - floor: toward −∞ (+2.9 → +2, −0.5 → −1)
 * - nearest: to nearest integer, halves away from zero (+2.5 → +3, −2.5 → −3)
 * - exact: no rounding; the answer is compared to one decimal place
 */
export type TrueCountRounding = "truncate" | "floor" | "nearest" | "exact";

export const ROUNDING_LABELS: Record<TrueCountRounding, string> = {
  truncate: "Truncate (toward zero)",
  floor: "Floor (round down)",
  nearest: "Round to nearest",
  exact: "Exact (1 decimal)",
};

export function rawTrueCount(rc: number, decksRemaining: number): number {
  if (!(decksRemaining > 0)) throw new Error("Decks remaining must be positive");
  return rc / decksRemaining;
}

export function roundTrueCount(raw: number, mode: TrueCountRounding): number {
  // Guard against floating-point noise such as 2.9999999 when the exact value is 3.
  const x = Math.round(raw * 1e9) / 1e9;
  switch (mode) {
    case "truncate":
      return Math.trunc(x) + 0; // + 0 normalises −0
    case "floor":
      return Math.floor(x) + 0;
    case "nearest":
      return (Math.sign(x) * Math.round(Math.abs(x))) + 0;
    case "exact":
      return Math.round(x * 10) / 10 + 0;
  }
}

export function trueCount(rc: number, decksRemaining: number, mode: TrueCountRounding): number {
  return roundTrueCount(rawTrueCount(rc, decksRemaining), mode);
}

/** Round a deck estimate to the nearest quarter deck (minimum 0.25). */
export function quarterDecks(cards: number): number {
  return Math.max(0.25, Math.round((cards / 52) * 4) / 4);
}

export function formatCount(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}
