"use client";

import { chartCode, strategyTableFor } from "@/lib/blackjack/strategy";
import type { TableRules } from "@/lib/blackjack/rules";
import type { UpcardRow } from "@/lib/blackjack/strategy-table";
import { cn } from "@/lib/utils";

const UPS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "1"];

const CODE_STYLE: Record<string, string> = {
  H: "bg-zinc-700/70 text-zinc-100",
  S: "bg-amber-500/80 text-amber-950",
  D: "bg-emerald-600/85 text-white",
  Ds: "bg-emerald-700/85 text-amber-100",
  P: "bg-sky-600/85 text-white",
  R: "bg-rose-600/85 text-white",
  Rs: "bg-rose-700/85 text-amber-100",
  Rp: "bg-rose-700/85 text-sky-100",
};

export const CODE_LEGEND: [string, string][] = [
  ["H", "Hit"],
  ["S", "Stand"],
  ["D", "Double, else hit"],
  ["Ds", "Double, else stand"],
  ["P", "Split"],
  ["R", "Surrender, else hit"],
  ["Rs", "Surrender, else stand"],
  ["Rp", "Surrender, else split"],
];

interface Row {
  key: string;
  label: string;
  cells: UpcardRow;
  pair: boolean;
}

export function StrategyChart({ rules, highlight }: { rules: TableRules; highlight?: { row: string; up: string } }) {
  const table = strategyTableFor(rules);
  const codes = (r: UpcardRow, pair: boolean) => UPS.map((u) => chartCode(r[u], rules, pair));
  const uniform = (rows: number[], code: string) =>
    rows.every((t) => codes(table.hard[t], false).every((c) => c === code));

  const hardRows: Row[] = [];
  const lowAllHit = uniform([5, 6, 7], "H");
  const highAllStand = uniform([18, 19, 20], "S");
  if (lowAllHit) hardRows.push({ key: "hard 7", label: "5–7", cells: table.hard[7], pair: false });
  for (let t = lowAllHit ? 8 : 5; t <= (highAllStand ? 17 : 20); t++)
    hardRows.push({ key: `hard ${t}`, label: String(t), cells: table.hard[t], pair: false });
  if (highAllStand) hardRows.push({ key: "hard 18", label: "18+", cells: table.hard[18], pair: false });

  const softRows: Row[] = [];
  for (let t = 13; t <= 20; t++) softRows.push({ key: `soft ${t}`, label: `A,${t - 11}`, cells: table.soft[t], pair: false });

  const pairRows: Row[] = [];
  for (const r of [1, 10, 9, 8, 7, 6, 5, 4, 3, 2]) {
    const l = r === 1 ? "A" : String(r);
    pairRows.push({ key: `pair ${l}`, label: `${l},${l}`, cells: table.pairs[r], pair: true });
  }

  const hlRow = highlight && normaliseRow(highlight.row, lowAllHit, highAllStand);
  const hlUp = highlight && (highlight.up === "A" ? "1" : highlight.up);

  const section = (title: string, rows: Row[]) => (
    <table className="w-full table-fixed self-start border-separate border-spacing-0.5 text-center text-[11px] font-semibold">
      <thead>
        <tr>
          <th className="w-12 text-left text-[10px] font-medium text-muted-foreground uppercase">{title}</th>
          {UPS.map((u) => (
            <th key={u} className="font-medium text-muted-foreground">
              {u === "1" ? "A" : u}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th className={cn("text-left font-medium text-muted-foreground", hlRow === row.key && "text-primary")}>{row.label}</th>
            {codes(row.cells, row.pair).map((c, i) => (
              <td
                key={i}
                className={cn(
                  "h-6 rounded-sm",
                  CODE_STYLE[c],
                  hlRow === row.key && hlUp === UPS[i] && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                )}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {section("Hard", hardRows)}
        {section("Soft", softRows)}
        {section("Pairs", pairRows)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {CODE_LEGEND.filter(([c]) => rules.surrender === "late" || !c.startsWith("R")).map(([c, l]) => (
          <span key={c} className="flex items-center gap-1">
            <span className={cn("rounded-sm px-1 font-semibold", CODE_STYLE[c])}>{c}</span>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function normaliseRow(row: string, lowGrouped: boolean, highGrouped: boolean): string {
  const m = /^hard (\d+)$/.exec(row);
  if (!m) return row;
  const t = Number(m[1]);
  if (lowGrouped && t <= 7) return "hard 7";
  if (highGrouped && t >= 18) return "hard 18";
  return row;
}
