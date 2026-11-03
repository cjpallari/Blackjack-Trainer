/**
 * Betting ramps: a mapping from the observed Hi-Lo true count to a wager.
 * Pure and shared by the batch simulator and the table's betting trainer, so
 * both size bets identically.
 *
 * Information boundary: a bet is sized from a PreBetObservation only — the
 * running count of cards already exposed, the number of cards left in the
 * shoe (estimated to a quarter deck), and the bankroll. Nothing about the
 * undealt cards' order or composition is available.
 */
import { trueCount, type TrueCountRounding } from "../blackjack/counting";

export interface RampStep {
  /** This many units at this true count and above (until the next step). */
  readonly minTc: number;
  readonly units: number;
}

export interface BettingRamp {
  readonly id: string;
  readonly name: string;
  /** Wager of one unit, in chips. */
  readonly unit: number;
  /** Units below the first step (negative / neutral counts). 0 = sit out the round. */
  readonly baseUnits: number;
  /** Increasing true-count thresholds. */
  readonly steps: readonly RampStep[];
}

export interface BetLimits {
  readonly tableMin: number;
  readonly tableMax: number;
  /** Bets are rounded down to a multiple of this chip size. */
  readonly chip: number;
}

export interface PreBetObservation {
  /** Hi-Lo count of every card exposed since the shuffle (0 when a new shoe is about to start). */
  readonly runningCount: number;
  /** Cards still in the shoe (undealt). */
  readonly cardsInShoe: number;
  readonly bankroll: number;
}

export type BetDecision =
  | { readonly kind: "bet"; readonly amount: number; readonly trueCount: number; readonly units: number; readonly constrained: BetConstraint | null }
  | { readonly kind: "sit-out"; readonly trueCount: number }
  | { readonly kind: "insufficient-bankroll"; readonly trueCount: number };

/** Why the ramp's wager was changed: table limits, chip size, or bankroll. */
export type BetConstraint = "table-min" | "table-max" | "chip" | "bankroll";

export function quarterDeckEstimate(cards: number): number {
  return Math.max(0.25, Math.round((cards / 52) * 4) / 4);
}

export function observedTrueCount(o: Pick<PreBetObservation, "runningCount" | "cardsInShoe">, convention: TrueCountRounding): number {
  return trueCount(o.runningCount, quarterDeckEstimate(o.cardsInShoe), convention);
}

export function rampUnits(ramp: BettingRamp, tc: number): number {
  let u = ramp.baseUnits;
  for (const s of ramp.steps) if (tc >= s.minTc) u = s.units;
  return u;
}

/** The wager a ramp calls for, after table limits, chip rounding and bankroll. */
export function decideBet(ramp: BettingRamp, limits: BetLimits, obs: PreBetObservation, convention: TrueCountRounding): BetDecision {
  const tc = observedTrueCount(obs, convention);
  const units = rampUnits(ramp, tc);
  if (units <= 0) return { kind: "sit-out", trueCount: tc };
  let amount = units * ramp.unit;
  let constrained: BetConstraint | null = null;
  if (amount < limits.tableMin) {
    amount = limits.tableMin;
    constrained = "table-min";
  }
  if (amount > limits.tableMax) {
    amount = limits.tableMax;
    constrained = "table-max";
  }
  const chipped = Math.floor(amount / limits.chip + 1e-9) * limits.chip;
  if (chipped !== amount) {
    amount = Math.max(chipped, limits.tableMin);
    constrained ??= "chip";
  }
  if (amount > obs.bankroll) {
    const affordable = Math.floor(obs.bankroll / limits.chip + 1e-9) * limits.chip;
    if (affordable < limits.tableMin) return { kind: "insufficient-bankroll", trueCount: tc };
    amount = affordable;
    constrained = "bankroll";
  }
  return { kind: "bet", amount, trueCount: tc, units, constrained };
}

export function validateRamp(ramp: BettingRamp, limits: BetLimits, allowSitOut: boolean): string[] {
  const errors: string[] = [];
  if (!(ramp.unit > 0)) errors.push("The betting unit must be positive.");
  if (ramp.baseUnits < 0 || ramp.steps.some((s) => s.units < 0)) errors.push("Units cannot be negative.");
  if (!allowSitOut && (ramp.baseUnits === 0 || ramp.steps.some((s) => s.units === 0)))
    errors.push("Sitting out (0 units) needs at least one other player at the table.");
  for (let i = 1; i < ramp.steps.length; i++) if (ramp.steps[i].minTc <= ramp.steps[i - 1].minTc) errors.push("True-count thresholds must increase.");
  if (!(limits.tableMin > 0) || limits.tableMax < limits.tableMin) errors.push("Table limits are invalid.");
  if (!(limits.chip > 0)) errors.push("Chip size must be positive.");
  return errors;
}

export function spreadOf(ramp: BettingRamp): string {
  const units = [ramp.baseUnits, ...ramp.steps.map((s) => s.units)].filter((u) => u > 0);
  if (!units.length) return "—";
  const lo = Math.min(...units);
  const hi = Math.max(...units);
  return lo === hi ? "flat" : `1–${Math.round((hi / lo) * 10) / 10}`;
}

export function describeRamp(ramp: BettingRamp): string {
  const parts = [`below TC ${fmt(ramp.steps[0]?.minTc ?? Infinity)}: ${ramp.baseUnits === 0 ? "sit out" : `${ramp.baseUnits}u`}`];
  for (const s of ramp.steps) parts.push(`TC ${fmt(s.minTc)}+: ${s.units}u`);
  return ramp.steps.length ? parts.join(" · ") : `${ramp.baseUnits}u flat`;
}

function fmt(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** Illustrative presets (not recommendations): units of $25 with a $25 table minimum. */
export const RAMP_PRESETS: readonly BettingRamp[] = [
  { id: "flat", name: "Flat", unit: 25, baseUnits: 1, steps: [] },
  { id: "1-2", name: "1–2 spread", unit: 25, baseUnits: 1, steps: [{ minTc: 2, units: 2 }] },
  {
    id: "1-4",
    name: "1–4 spread",
    unit: 25,
    baseUnits: 1,
    steps: [
      { minTc: 2, units: 2 },
      { minTc: 3, units: 3 },
      { minTc: 4, units: 4 },
    ],
  },
  {
    id: "1-6",
    name: "1–6 spread",
    unit: 25,
    baseUnits: 1,
    steps: [
      { minTc: 2, units: 2 },
      { minTc: 3, units: 4 },
      { minTc: 4, units: 6 },
    ],
  },
  {
    id: "1-8",
    name: "1–8 spread",
    unit: 25,
    baseUnits: 1,
    steps: [
      { minTc: 2, units: 2 },
      { minTc: 3, units: 4 },
      { minTc: 4, units: 6 },
      { minTc: 5, units: 8 },
    ],
  },
];

export const DEFAULT_LIMITS: BetLimits = { tableMin: 25, tableMax: 1000, chip: 5 };
