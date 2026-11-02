/**
 * Prints the index validation tables (markdown) from the committed data:
 *   npm run report:indices
 */
import { DEVIATION_CELLS } from "../src/lib/blackjack/deviations/definitions";
import { pairThreshold } from "../src/lib/blackjack/analysis/index-gen";
import { describeIndex, describeValidated, entryFor, resolveIndexSet } from "../src/lib/blackjack/deviations/registry";
import { validationFor, type McCellResult, type McValidationFile } from "../src/lib/blackjack/deviations/validation";
import full from "../src/lib/blackjack/deviations/data/hilo-validation.full.json";

const VALIDATION = full as unknown as McValidationFile;
import { DEFAULT_RULES } from "../src/lib/blackjack/rules";
import type { TrueCountRounding } from "../src/lib/blackjack/counting";

void pairThreshold;
const conv = (process.argv[2] ?? "floor") as TrueCountRounding;

function crossingDetail(r: McCellResult | undefined, ls: boolean) {
  if (!r) return "";
  const v = r.variants.find((x) => x.surrender === ls && x.das) ?? r.variants.find((x) => x.surrender === ls) ?? r.variants[0];
  const c = v.conventions[conv === "exact" ? "floor" : (conv as "floor")];
  const t = c.transitions[0];
  if (!t) return c.note;
  const near = c.buckets.filter((b) => Math.abs(b.tc - t.at) <= 1);
  return near.map((b) => `${b.tc >= 0 ? "+" : ""}${b.tc}: ${b.best} by ${(b.margin ?? 0).toFixed(4)}±${(b.se ?? 0).toFixed(4)} (n=${b.n})${b.resolved ? "" : "?"}`).join("; ");
}

for (const [decks, h17] of [
  [2, true],
  [2, false],
  [6, false],
  [6, true],
] as const) {
  for (const ls of [false, true]) {
    const rules = { ...DEFAULT_RULES, decks, dealerHitsSoft17: h17, surrender: (ls ? "late" : "none") as "late" | "none" };
    const res = resolveIndexSet(rules, conv);
    if (!res.supported) continue;
    console.log(`\n### ${decks}D ${h17 ? "H17" : "S17"} DAS ${ls ? "LS" : "NS"} (${conv})\n`);
    console.log("| Play | Published (6D S17) | Synthetic | Monte Carlo | Status | Crossing detail |");
    console.log("|---|---|---|---|---|---|");
    for (const cell of DEVIATION_CELLS) {
      if (!ls && cell.published.every((p) => p.above === "surrender")) continue;
      const pub = cell.published.map((p) => `${p.above} ≥ ${p.index >= 0 ? "+" : ""}${p.index}`).join(", ");
      const syn = describeIndex(entryFor(res.set, cell.id)!, conv).replace(/\.$/, "");
      const v = validationFor(res.set, cell.id, conv);
      const mc = v.result ? describeValidated(v.result).replace(/\.$/, "") : "—";
      const r = VALIDATION.results.find((x) => x.decks === decks && x.h17 === h17 && x.cellId === cell.id && !x.threeCard);
      console.log(`| ${cell.label} | ${pub} | ${syn} | ${mc} | ${v.status}${v.status !== "validated" ? `: ${v.reason}` : ""} | ${crossingDetail(r, ls)} |`);
    }
  }
}

console.log("\n### Three-card hands (diagnostic, floor)\n");
for (const r of VALIDATION.results.filter((x) => x.threeCard)) {
  for (const v of r.variants) {
    const c = v.conventions.floor;
    console.log(`- ${r.decks}D ${r.h17 ? "H17" : "S17"} ${r.cellId} ${v.surrender ? "LS" : "NS"}: ${c.verdict === "validated" ? describeValidated(c) : c.note} (${r.states} states)`);
  }
}
const totalStates = VALIDATION.results.reduce((n, r) => n + r.states, 0);
console.log(`\nTotal Monte Carlo states: ${totalStates.toLocaleString()} across ${VALIDATION.results.length} jobs.`);
