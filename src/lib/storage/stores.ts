import type { TrueCountRounding } from "../blackjack/counting";
import { DECK_OPTIONS, DEFAULT_RULES, validateRules, type TableRules } from "../blackjack/rules";
import { DEFAULT_BS_OPTIONS, type BSOptions } from "../training/basic-strategy";
import { DEFAULT_RC_CONFIG, type RCConfig } from "../training/running-count";
import { emptyStats, parseStats, type Stats } from "../training/stats";
import { DEFAULT_CHECKPOINTS, type CheckpointConfig } from "../training/table/count-checks";
import { emptyShoeHistory, parseShoeHistory, type ShoeHistory } from "../training/table/history";
import { DEFAULT_INTERMEDIATE, type IntermediateOptions, type TrainingMode } from "../training/table/modes";
import { createPersistentStore } from "./persistent-store";
import { DEFAULT_LIMITS, RAMP_PRESETS, type BetLimits, type BettingRamp } from "../betting/ramp";
import type { PlayStrategy } from "../sim/simulate";

export interface Settings {
  version: 1;
  rules: TableRules;
  rounding: TrueCountRounding;
  bs: BSOptions;
  rc: RCConfig;
  tc: { decks: number; timed: boolean; secondsPerQuestion: number; showTrayGuides: boolean };
  dev: { filter: "all" | "valuable" | "positive" | "negative" | "missed" | string; showTrueCount: boolean; showTray: boolean };
  sim: SimSettings;
  betting: BettingSettings;
}

export interface BettingSettings {
  ramp: BettingRamp;
  limits: BetLimits;
  /** Simulation-only settings. */
  otherPlayers: number;
  seat: number;
  play: PlayStrategy;
  /** Penetration used by the betting lab (independent of the table rules). */
  penetration: number;
  rounds: number;
  /** Illustrative assumption for hourly figures. */
  roundsPerHour: number;
  seed: number;
  bankroll: number;
  horizon: number;
  trials: number;
  profitTarget: number;
  /** Betting Training Mode at the simulator table. */
  tableTraining: boolean;
}

export type AnimationSpeed = "instant" | "fast" | "normal" | "slow";

export interface TableTrainingSettings {
  mode: TrainingMode;
  intermediate: IntermediateOptions;
  checkpoints: CheckpointConfig;
  /** Keep per-decision logs in saved shoe reports. */
  keepDecisionDetail: boolean;
  /** Grade and hint count-based index plays when a validated index set exists. */
  deviations: boolean;
}

export interface SimSettings {
  animation: AnimationSpeed;
  training: TableTrainingSettings;
  /** 0-based seat from first base. */
  humanSeat: number;
  startingBankroll: number;
  lastBet: number;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  rules: DEFAULT_RULES,
  rounding: "truncate",
  bs: DEFAULT_BS_OPTIONS,
  rc: DEFAULT_RC_CONFIG,
  tc: { decks: 6, timed: false, secondsPerQuestion: 8, showTrayGuides: false },
  dev: { filter: "all", showTrueCount: true, showTray: false },
  betting: {
    ramp: RAMP_PRESETS[4],
    limits: DEFAULT_LIMITS,
    otherPlayers: 2,
    seat: 1,
    play: "deviations",
    penetration: 0.7,
    rounds: 100_000,
    roundsPerHour: 100,
    seed: 1,
    bankroll: 5000,
    horizon: 5000,
    trials: 200,
    profitTarget: 2500,
    tableTraining: false,
  },
  sim: {
    animation: "normal",
    humanSeat: 1,
    startingBankroll: 1000,
    lastBet: 10,
    training: { mode: "beginner", intermediate: DEFAULT_INTERMEDIATE, checkpoints: DEFAULT_CHECKPOINTS, keepDecisionDetail: false, deviations: true },
  },
};

export function parseSettings(raw: unknown): Settings | null {
  if (!raw || typeof raw !== "object" || (raw as { version?: unknown }).version !== 1) return null;
  const r = raw as Partial<Settings>;
  const rules = { ...DEFAULT_RULES, ...r.rules, variant: "standard" as const, dealerPeeks: true as const };
  if (!DECK_OPTIONS.includes(rules.decks) || validateRules(rules).length) return null;
  return {
    ...DEFAULT_SETTINGS,
    ...r,
    rules,
    bs: { ...DEFAULT_SETTINGS.bs, ...r.bs },
    rc: { ...DEFAULT_SETTINGS.rc, ...r.rc },
    tc: { ...DEFAULT_SETTINGS.tc, ...r.tc },
    dev: { ...DEFAULT_SETTINGS.dev, ...r.dev },
    betting: { ...DEFAULT_SETTINGS.betting, ...r.betting, limits: { ...DEFAULT_SETTINGS.betting.limits, ...r.betting?.limits } },
    sim: {
      ...DEFAULT_SETTINGS.sim,
      ...r.sim,
      training: {
        ...DEFAULT_SETTINGS.sim.training,
        ...r.sim?.training,
        intermediate: { ...DEFAULT_SETTINGS.sim.training.intermediate, ...r.sim?.training?.intermediate },
        checkpoints: { ...DEFAULT_SETTINGS.sim.training.checkpoints, ...r.sim?.training?.checkpoints },
      },
    },
  };
}

export const settingsStore = createPersistentStore<Settings>("bjtrain.settings", DEFAULT_SETTINGS, parseSettings);
export const statsStore = createPersistentStore<Stats>("bjtrain.stats", emptyStats(), parseStats);
export const shoeHistoryStore = createPersistentStore<ShoeHistory>("bjtrain.shoes", emptyShoeHistory(), parseShoeHistory);
