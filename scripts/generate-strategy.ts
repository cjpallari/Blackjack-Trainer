/**
 * Regenerates src/lib/blackjack/strategy-data/*.json from the combinatorial
 * analyzer. Run with: npm run generate:strategy [-- 2D-H17 6D-S17 ...]
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateStrategyTable } from "../src/lib/blackjack/analysis/generate";
import { DECK_OPTIONS } from "../src/lib/blackjack/rules";
import { strategyTableId } from "../src/lib/blackjack/strategy-table";

const outDir = join(__dirname, "..", "src", "lib", "blackjack", "strategy-data");
const only = new Set(process.argv.slice(2));

for (const decks of DECK_OPTIONS) {
  for (const h17 of [false, true]) {
    const id = strategyTableId(decks, h17);
    if (only.size && !only.has(id)) continue;
    const t0 = Date.now();
    const table = generateStrategyTable({ decks, dealerHitsSoft17: h17 });
    writeFileSync(join(outDir, `${id}.json`), JSON.stringify(table, null, 1) + "\n");
    console.log(`${id}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}
