"use client";

import { useState } from "react";
import type { DayBucket, Tally } from "@/lib/training/stats";
import { cn } from "@/lib/utils";

/** Validated categorical slots (dark surface): blue, orange, aqua. */
const SERIES = [
  { key: "bs", label: "Basic strategy", color: "#3987e5" },
  { key: "rc", label: "Running count", color: "#d95926" },
  { key: "tc", label: "True count", color: "#199e70" },
] as const;

type Key = (typeof SERIES)[number]["key"];

const acc = (t: Tally) => (t.attempts ? t.correct / t.attempts : null);

export function ProgressChart({ history }: { history: DayBucket[] }) {
  const days = history.slice(-30);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  if (days.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Practice in any trainer to start a daily accuracy history.</p>;
  }

  const W = 640;
  const H = 220;
  const m = { l: 36, r: 96, t: 12, b: 24 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const x = (i: number) => m.l + (days.length === 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = (v: number) => m.t + (1 - v) * ih;

  const paths = SERIES.map((s) => {
    let d = "";
    let pen = false;
    days.forEach((b, i) => {
      const v = acc(b[s.key]);
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    const lastIdx = days.map((b) => acc(b[s.key])).findLastIndex((v) => v !== null);
    return { ...s, d, lastIdx, last: lastIdx >= 0 ? acc(days[lastIdx][s.key]) : null };
  });

  // Spread end labels so they don't collide.
  const labels = paths
    .filter((p) => p.last !== null)
    .map((p) => ({ key: p.key, label: p.label, y: y(p.last!), v: p.last! }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * iw;
    const i = days.length === 1 ? 0 : Math.round((px / iw) * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  };

  const hb = hover !== null ? days[hover] : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs text-primary hover:underline">
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {showTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="tabular w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Day</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-1 font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((b) => (
                <tr key={b.date} className="border-t border-border">
                  <td className="py-1">{b.date}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="py-1">
                      {cell(b[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily accuracy by trainer">
            {[0, 0.5, 1].map((v) => (
              <g key={v}>
                <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-border" strokeWidth={1} />
                <text x={m.l - 6} y={y(v)} fontSize={10} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground">
                  {v * 100}%
                </text>
              </g>
            ))}
            <text x={m.l} y={H - 6} fontSize={10} className="fill-muted-foreground">
              {short(days[0].date)}
            </text>
            {days.length > 1 && (
              <text x={m.l + iw} y={H - 6} fontSize={10} textAnchor="end" className="fill-muted-foreground">
                {short(days[days.length - 1].date)}
              </text>
            )}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="currentColor" className="text-muted-foreground/50" strokeWidth={1} />}
            {paths.map((p) => (
              <g key={p.key}>
                <path d={p.d} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {days.map((b, i) => {
                  const v = acc(b[p.key as Key]);
                  // Isolated points (gaps on both sides) need a marker to be visible.
                  const prev = i > 0 ? acc(days[i - 1][p.key as Key]) : null;
                  const nextV = i < days.length - 1 ? acc(days[i + 1][p.key as Key]) : null;
                  const show = v !== null && ((prev === null && nextV === null) || hover === i);
                  return show ? <circle key={i} cx={x(i)} cy={y(v!)} r={4} fill={p.color} stroke="var(--card)" strokeWidth={2} /> : null;
                })}
              </g>
            ))}
            {labels.map((l) => (
              <text key={l.key} x={m.l + iw + 8} y={l.y} fontSize={10} dominantBaseline="central" className="fill-muted-foreground">
                {SERIES.find((s) => s.key === l.key)!.label.split(" ")[0]} {Math.round(l.v * 100)}%
              </text>
            ))}
            <rect
              x={m.l}
              y={m.t}
              width={iw}
              height={ih}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
          {hb && hover !== null && (
            <div
              className={cn(
                "pointer-events-none absolute top-2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg",
                x(hover) > W / 2 ? "-translate-x-[calc(100%+8px)]" : "translate-x-2",
              )}
              style={{ left: `${(x(hover) / W) * 100}%` }}
            >
              <div className="mb-1 text-muted-foreground">{hb.date}</div>
              {SERIES.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                  <span className="tabular font-semibold">{cell(hb[s.key])}</span>
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

function cell(t: Tally): string {
  return t.attempts ? `${Math.round((t.correct / t.attempts) * 100)}% (${t.attempts})` : "—";
}

function short(date: string): string {
  const [, mo, d] = date.split("-");
  return `${Number(mo)}/${Number(d)}`;
}
