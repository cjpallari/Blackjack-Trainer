/**
 * Betting training at the table: grade the wager the player placed against
 * their configured ramp, using only the pre-bet observation. The wager is
 * kept and the round is played normally; bet accuracy is tracked separately
 * from playing strategy and counting.
 */
import type { TrueCountRounding } from "../../blackjack/counting";
import { decideBet, type BetLimits, type BettingRamp, type PreBetObservation } from "../../betting/ramp";

export interface BettingTrainingOptions {
  readonly ramp: BettingRamp;
  readonly limits: BetLimits;
}

export interface BetRecord {
  readonly round: number;
  readonly rampName: string;
  readonly trueCount: number;
  /** Wager the ramp calls for (after table limits, chips and bankroll). */
  readonly recommended: number;
  readonly chosen: number;
  readonly correct: boolean;
  /** The ramp would sit out, which this table doesn't allow; the table minimum is the closest legal bet. */
  readonly rampSitsOut: boolean;
}

export function recommendBet(o: BettingTrainingOptions, obs: PreBetObservation, convention: TrueCountRounding) {
  const d = decideBet(o.ramp, o.limits, obs, convention);
  if (d.kind === "bet") return { amount: d.amount, trueCount: d.trueCount, sitsOut: false };
  if (d.kind === "sit-out") return { amount: o.limits.tableMin, trueCount: d.trueCount, sitsOut: true };
  return { amount: 0, trueCount: d.trueCount, sitsOut: false };
}

export function gradeBet(o: BettingTrainingOptions, obs: PreBetObservation, convention: TrueCountRounding, chosen: number, round: number): BetRecord {
  const r = recommendBet(o, obs, convention);
  return { round, rampName: o.ramp.name, trueCount: r.trueCount, recommended: r.amount, chosen, correct: chosen === r.amount, rampSitsOut: r.sitsOut };
}
