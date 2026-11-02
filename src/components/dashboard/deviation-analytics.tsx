"use client";

import { StatTile, pct } from "@/components/training/controls";
import { useShoeHistory, useStats } from "@/hooks/use-store";
import { CELL_BY_ID } from "@/lib/blackjack/deviations/definitions";
import { aggregateHistory } from "@/lib/training/table/history";
import { accuracy } from "@/lib/training/stats";

const ratio = (a: number, b: number) => (b ? a / b : null);

/** Deviation results from the trainer and from graded table shoes, kept separate. */
export function DeviationAnalytics() {
  const [stats] = useStats();
  const [history] = useShoeHistory();
  const agg = aggregateHistory(history.reports);
  const trainerCells = Object.entries(stats.dev.byCell)
    .map(([id, t]) => ({ id, label: CELL_BY_ID.get(id)?.label ?? id, ...t }))
    .sort((a, b) => b.misses - a.misses || b.attempts - a.attempts);
  const tableCells = agg.byCell;
  const ids = [...new Set([...trainerCells.map((c) => c.id), ...tableCells.map((c) => c.cellId)])];

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Count-based deviations</h2>
        <p className="text-xs text-muted-foreground">
          Index-play accuracy from the Deviation Trainer and from graded table shoes. Right or wrong only: no EV gain from deviations is estimated.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Trainer" value={pct(accuracy(stats.dev.overall))} sub={`${stats.dev.overall.attempts} answers`} />
        <StatTile label="Table opportunities" value={agg.deviationOpportunities} sub={`${agg.deviationShoes} graded shoes`} />
        <StatTile label="Deviations made" value={pct(ratio(agg.deviationFollowed, agg.deviationOpportunities))} sub={`${agg.deviationFollowed} made`} />
        <StatTile label="Missed" value={agg.deviationMissed} sub="played basic instead" />
        <StatTile label="Not due" value={agg.wrongDeviations} sub="index play too early" />
        <StatTile
          label="Most missed"
          value={trainerCells[0]?.misses ? trainerCells[0].label : (tableCells[0]?.missed ? tableCells[0].label : "—")}
          sub="trainer, then table"
        />
      </div>
      {ids.length > 0 && (
        <div className="overflow-auto rounded-xl border border-border bg-card p-4">
          <table className="tabular w-full min-w-[420px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Index</th>
                <th className="py-1 font-medium">Trainer accuracy</th>
                <th className="py-1 font-medium">Table correct</th>
                <th className="py-1 font-medium">Table missed</th>
                <th className="py-1 font-medium">Table not due</th>
              </tr>
            </thead>
            <tbody>
              {ids.map((id) => {
                const tr = stats.dev.byCell[id];
                const tb = tableCells.find((c) => c.cellId === id);
                return (
                  <tr key={id} className="border-t border-border">
                    <td className="py-1">{CELL_BY_ID.get(id)?.label ?? id}</td>
                    <td className="py-1">{tr ? `${pct(accuracy(tr))} (${tr.attempts})` : "—"}</td>
                    <td className="py-1">{tb ? `${tb.correct}/${tb.decisions}` : "—"}</td>
                    <td className="py-1">{tb?.missed ?? "—"}</td>
                    <td className="py-1">{tb?.wrong ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
