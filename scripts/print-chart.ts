/** Prints a strategy chart for a ruleset. Usage: tsx scripts/print-chart.ts 6 S17 DAS LS */
import { chartCode, strategyTableFor } from "../src/lib/blackjack/strategy";
import type { DeckCount } from "../src/lib/blackjack/rules";

const [d = "6", h = "S17", das = "DAS", ls = "LS"] = process.argv.slice(2);
const table = strategyTableFor({ variant: "standard", decks: Number(d) as DeckCount, dealerHitsSoft17: h === "H17" });
const rules = { doubleAfterSplit: das === "DAS", surrender: ls === "LS" ? ("late" as const) : ("none" as const) };
const ups = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "1"];
const line = (label: string, row: Record<string, Parameters<typeof chartCode>[0]>, pair: boolean) =>
  console.log(label.padEnd(6) + ups.map((u) => chartCode(row[u], rules, pair).padEnd(3)).join(""));
console.log(`${d}D ${h} ${das} ${ls}`);
console.log("      " + ups.map((u) => (u === "1" ? "A" : u).padEnd(3)).join(""));
for (let t = 5; t <= 19; t++) line(`H${t}`, table.hard[t], false);
for (let t = 13; t <= 20; t++) line(`S${t}`, table.soft[t], false);
for (let r = 2; r <= 10; r++) line(`${r},${r}`, table.pairs[r], true);
line("A,A", table.pairs[1], true);
