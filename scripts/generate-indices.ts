/**
 * Regenerates src/lib/blackjack/deviations/data/hilo-indices.json.
 * Run with: npm run generate:indices
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildIndexSet, cellCurves } from "../src/lib/blackjack/analysis/index-gen";
import { DEVIATION_CELLS } from "../src/lib/blackjack/deviations/definitions";
import { INDEX_METHOD, SUPPORTED_INDEX_DECKS, type IndexFile, type IndexSet } from "../src/lib/blackjack/deviations/registry";

const sets: IndexSet[] = [];
for (const decks of SUPPORTED_INDEX_DECKS) {
  for (const h17 of [false, true]) {
    const t0 = Date.now();
    const noDas = DEVIATION_CELLS.map((cell) => cellCurves(cell, decks, h17, false));
    // DAS only changes split EVs, so only pair cells need recomputing.
    const withDas = DEVIATION_CELLS.map((cell, i) => (cell.hand?.kind === "pair" ? cellCurves(cell, decks, h17, true) : noDas[i]));
    for (const das of [false, true]) {
      for (const surrender of [false, true]) sets.push(buildIndexSet({ decks, h17, das, surrender }, das ? withDas : noDas));
    }
    console.log(`${decks}D ${h17 ? "H17" : "S17"}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}

const file: IndexFile = { version: 1, system: "hi-lo", method: INDEX_METHOD, sets };
writeFileSync(join(__dirname, "..", "src", "lib", "blackjack", "deviations", "data", "hilo-indices.json"), JSON.stringify(file) + "\n");
