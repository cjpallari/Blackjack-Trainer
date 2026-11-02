import type { TrueCountRounding } from "../blackjack/counting";
import { DECK_OPTIONS, DEFAULT_RULES, validateRules, type TableRules } from "../blackjack/rules";
import { DEFAULT_BS_OPTIONS, type BSOptions } from "../training/basic-strategy";
import { DEFAULT_RC_CONFIG, type RCConfig } from "../training/running-count";
import { emptyStats, parseStats, type Stats } from "../training/stats";
import { createPersistentStore } from "./persistent-store";

export interface Settings {
  version: 1;
  rules: TableRules;
  rounding: TrueCountRounding;
  bs: BSOptions;
  rc: RCConfig;
  tc: { decks: number; timed: boolean; secondsPerQuestion: number; showTrayGuides: boolean };
  sim: SimSettings;
}

export type AnimationSpeed = "instant" | "fast" | "normal" | "slow";

export interface SimSettings {
  animation: AnimationSpeed;
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
  sim: { animation: "normal", humanSeat: 1, startingBankroll: 1000, lastBet: 10 },
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
    sim: { ...DEFAULT_SETTINGS.sim, ...r.sim },
  };
}

export const settingsStore = createPersistentStore<Settings>("bjtrain.settings", DEFAULT_SETTINGS, parseSettings);
export const statsStore = createPersistentStore<Stats>("bjtrain.stats", emptyStats(), parseStats);
