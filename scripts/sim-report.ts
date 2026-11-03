/**
 * Representative Phase 8 measurements for 2 decks, H17, 3:2, DAS, no
 * surrender, 70% penetration. Each task writes JSON:
 *
 *   tsx scripts/sim-report.ts <task> <out.json>
 *   tasks: flat-<seed> | compare | penetration | ror-<bankroll>
 */
import { writeFileSync } from "node:fs";
import { DEFAULT_RULES } from "../src/lib/blackjack/rules";
import { DEFAULT_LIMITS, RAMP_PRESETS } from "../src/lib/betting/ramp";
import { runCompare, runEv, runPenetration, runRor } from "../src/lib/sim/analyses";
import type { SimConfig } from "../src/lib/sim/simulate";

const [task, out] = process.argv.slice(2);
const ramp = (id: string) => RAMP_PRESETS.find((r) => r.id === id)!;
const RULES = { ...DEFAULT_RULES, decks: 2 as const, dealerHitsSoft17: true, blackjackPayout: "3:2" as const, surrender: "none" as const, penetration: 0.7 };
const SIM: SimConfig = { rules: RULES, otherPlayers: 2, seat: 1, ramp: ramp("1-8"), limits: DEFAULT_LIMITS, convention: "truncate", play: "deviations" };
const RPH = 100;

let result: unknown;
if (task.startsWith("flat-")) {
  const seed = Number(task.slice(5));
  result = runEv({ sim: { ...SIM, otherPlayers: 0, seat: 0, ramp: ramp("flat"), play: "basic" }, rounds: 3_000_000, seed, roundsPerHour: RPH });
} else if (task === "compare") {
  result = runCompare({ sim: SIM, ramps: ["flat", "1-2", "1-4", "1-6", "1-8"].map(ramp), rounds: 2_000_000, seed: 2025, roundsPerHour: RPH });
} else if (task === "penetration") {
  result = runPenetration({ sim: SIM, penetrations: [0.5, 0.6, 0.65, 0.7, 0.71, 0.75], rounds: 1_000_000, seed: 77, roundsPerHour: RPH });
} else if (task.startsWith("ror-")) {
  const bankroll = Number(task.slice(4));
  result = runRor({ sim: SIM, bankroll, rounds: 10_000, trials: 600, profitTarget: bankroll, seed: 31, samplePaths: 0 });
}
const strip = (x: unknown): unknown =>
  JSON.parse(JSON.stringify(x, (k, v) => (k === "shoeNets" || k === "shoeRounds" || k === "paths" ? undefined : v)));
writeFileSync(out, JSON.stringify(strip(result), null, 1));
console.log(task, "done");
