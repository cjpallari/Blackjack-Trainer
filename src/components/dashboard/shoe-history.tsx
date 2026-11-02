"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatTile, pct } from "@/components/training/controls";
import { ShoeReportView } from "@/components/training/shoe-report";
import { useShoeHistory } from "@/hooks/use-store";
import { aggregateHistory } from "@/lib/training/table/history";
import { MODE_LABELS } from "@/lib/training/table/modes";
import { TERMINATION_LABEL, type ShoeReport } from "@/lib/training/table/shoe-tracker";
import { cn } from "@/lib/utils";

/** Validated categorical slots (dark surface): blue, aqua. */
const SERIES = [
  { key: "count", label: "Count checks correct", color: "#3987e5" },
  { key: "strategy", label: "Strategy accuracy", color: "#199e70" },
] as const;

const ratio = (a: number, b: number) => (b ? a / b : null);

function shoeValues(r: ShoeReport) {
  return {
    count: r.counting.valid ? ratio(r.counting.correct, r.counting.answered) : null,
    strategy: r.strategy.accuracy,
  };
}

export function ShoeHistorySection() {
  const [history] = useShoeHistory();
  const [open, setOpen] = useState<string | null>(null);
  const reports = history.reports;
  const agg = aggregateHistory(reports);
  const selected = reports.find((r) => r.id === open);

  if (selected) {
    return (
      <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => setOpen(null)}>
          <ChevronLeft className="size-4" /> All shoes
        </Button>
        <ShoeReportView report={selected} />
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Table shoes</h2>
        <p className="text-xs text-muted-foreground">
          Complete shoes played at the simulator. Counting figures use only shoes with a valid count
          {agg.excludedShoes ? ` (${agg.excludedShoes} interrupted shoe${agg.excludedShoes > 1 ? "s" : ""} excluded)` : ""}.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Shoes" value={agg.shoes} sub={`${agg.validShoes} with valid counts`} />
        <StatTile label="Count checks" value={pct(ratio(agg.rcCorrect, agg.checkpoints))} sub={`${agg.rcCorrect}/${agg.checkpoints} exact`} />
        <StatTile label="Final counts" value={pct(ratio(agg.finalCorrect, agg.finalAnswered))} sub={`${agg.finalCorrect}/${agg.finalAnswered} exact`} />
        <StatTile label="True counts" value={pct(ratio(agg.tcCorrect, agg.tcAnswered))} sub={`${agg.tcAnswered} answered`} />
        <StatTile label="Deck estimates" value={pct(ratio(agg.deckCorrect, agg.deckEstimates))} sub={`${agg.deckEstimates} estimates`} />
        <StatTile
          label="Table strategy"
          value={pct(ratio(agg.decisionsCorrect, agg.decisions), 1)}
          sub={`est. EV lost ${(agg.estimatedEvLost * 100).toFixed(1)}% of a bet`}
        />
      </div>

      {reports.length === 0 ? (
        <p className="rounded-xl border border-border bg-card py-8 text-center text-sm text-muted-foreground">
          Finish a shoe at the simulator to see it here.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Progress by shoe</h3>
            <ShoeTrend reports={reports.slice(-40)} />
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Recent shoes</h3>
            <ul className="max-h-80 divide-y divide-border overflow-auto">
              {[...reports].reverse().slice(0, 30).map((r) => {
                const v = shoeValues(r);
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setOpen(r.id)} className="flex w-full items-center justify-between gap-3 py-2 text-left text-xs hover:text-primary">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">
                          {new Date(r.endedAt).toLocaleDateString()} · {r.decks}D {r.dealerHitsSoft17 ? "H17" : "S17"} · {r.modes.map((m) => MODE_LABELS[m]).join("/")}
                        </span>
                        <span className={cn("text-muted-foreground", !r.completedNormally && "text-amber-300")}>
                          {r.shoe.rounds} rounds · {Math.round(r.shoe.finalPenetration * 100)}% · {TERMINATION_LABEL[r.termination]}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-right text-muted-foreground">
                        <span className="block">count {r.counting.valid ? pct(v.count) : "excluded"}</span>
                        <span className="block">strategy {pct(v.strategy)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function ShoeTrend({ reports }: { reports: readonly ShoeReport[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const pts = reports.map(shoeValues);
  const W = 560;
  const H = 200;
  const m = { l: 36, r: 12, t: 12, b: 22 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const x = (i: number) => m.l + (reports.length === 1 ? iw / 2 : (i / (reports.length - 1)) * iw);
  const y = (v: number) => m.t + (1 - v) * ih;
  const path = (k: "count" | "strategy") => {
    let d = "";
    let pen = false;
    pts.forEach((p, i) => {
      const v = p[k];
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(reports.length - 1, Math.round(f * (reports.length - 1)))));
  };
  const hp = hover !== null ? pts[hover] : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <button type="button" onClick={() => setTable((v) => !v)} className="text-xs text-primary hover:underline">
          {table ? "Chart" : "Table"}
        </button>
      </div>
      {table ? (
        <div className="max-h-52 overflow-auto">
          <table className="tabular w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Shoe</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-1 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((r, i) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1">{new Date(r.endedAt).toLocaleDateString()}</td>
                  <td className="py-1">{r.counting.valid ? pct(pts[i].count) : "excluded"}</td>
                  <td className="py-1">{pct(pts[i].strategy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Accuracy by shoe">
            {[0, 0.5, 1].map((v) => (
              <g key={v}>
                <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-border" />
                <text x={m.l - 6} y={y(v)} fontSize={10} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground">
                  {v * 100}%
                </text>
              </g>
            ))}
            <text x={m.l} y={H - 5} fontSize={10} className="fill-muted-foreground">
              older
            </text>
            <text x={m.l + iw} y={H - 5} fontSize={10} textAnchor="end" className="fill-muted-foreground">
              latest
            </text>
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="currentColor" className="text-muted-foreground/50" />}
            {SERIES.map((s) => (
              <g key={s.key}>
                <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => {
                  const v = p[s.key];
                  return v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : 3} fill={s.color} stroke="var(--card)" strokeWidth={1.5} />;
                })}
              </g>
            ))}
            <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
          {hp && hover !== null && (
            <div
              className={cn(
                "pointer-events-none absolute top-1 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg",
                x(hover) > W / 2 ? "-translate-x-[calc(100%+8px)]" : "translate-x-2",
              )}
              style={{ left: `${(x(hover) / W) * 100}%` }}
            >
              <div className="text-muted-foreground">{new Date(reports[hover].endedAt).toLocaleString()}</div>
              {SERIES.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                  <span className="tabular font-semibold">{reports[hover].counting.valid || s.key === "strategy" ? pct(hp[s.key]) : "excluded"}</span>
                  <span className="text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
