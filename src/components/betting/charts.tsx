"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Validated categorical slots on the dark surface (see dataviz palette). */
export const PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500"] as const;

function Tooltip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-1 z-10 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg",
        x > width / 2 ? "-translate-x-[calc(100%+8px)]" : "translate-x-2",
      )}
      style={{ left: `${(x / width) * 100}%` }}
    >
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; kind?: "bar" | "line" | "dot" }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            className={i.kind === "line" ? "h-0.5 w-4 rounded-full" : i.kind === "dot" ? "size-2 rounded-full" : "size-2.5 rounded-[2px]"}
            style={{ background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function TableToggle({ table, setTable }: { table: boolean; setTable: (v: boolean) => void }) {
  return (
    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setTable(!table)}>
      {table ? "Chart" : "Table"}
    </button>
  );
}

/** Grouped vertical bars, one group per category. */
export function GroupedBars({
  categories,
  series,
  format,
  caption,
}: {
  categories: readonly string[];
  series: readonly { label: string; values: readonly number[] }[];
  format: (v: number) => string;
  caption?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 640;
  const H = 220;
  const m = { l: 40, r: 8, t: 10, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = Math.max(1e-9, ...series.flatMap((s) => s.values));
  const gw = iw / categories.length;
  const bw = Math.max(4, (gw - 10) / series.length - 2);
  const y = (v: number) => m.t + ih - (v / max) * ih;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend items={series.map((s, i) => ({ label: s.label, color: PALETTE[i] }))} />
        <TableToggle table={table} setTable={setTable} />
      </div>
      {table ? (
        <table className="tabular w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Bin</th>
              {series.map((s) => (
                <th key={s.label} className="py-1 font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((c, i) => (
              <tr key={c} className="border-t border-border">
                <td className="py-1">{c}</td>
                {series.map((s) => (
                  <td key={s.label} className="py-1">
                    {format(s.values[i])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={caption}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={m.l} x2={m.l + iw} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" className="text-border" />
                <text x={m.l - 6} y={y(max * f)} fontSize={10} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground">
                  {format(max * f)}
                </text>
              </g>
            ))}
            {categories.map((c, i) => {
              const x0 = m.l + i * gw + (gw - series.length * (bw + 2)) / 2;
              return (
                <g key={c} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                  <rect x={m.l + i * gw} y={m.t} width={gw} height={ih} fill="transparent" />
                  {series.map((s, k) => {
                    const v = s.values[i];
                    const top = y(v);
                    const h = Math.max(0, m.t + ih - top);
                    return (
                      <path
                        key={s.label}
                        d={`M${x0 + k * (bw + 2)},${m.t + ih} v${-Math.max(0, h - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${Math.max(0, h - 3)} z`}
                        fill={PALETTE[k]}
                        opacity={hover === null || hover === i ? 1 : 0.55}
                      />
                    );
                  })}
                  <text x={m.l + i * gw + gw / 2} y={H - 8} fontSize={10} textAnchor="middle" className="fill-muted-foreground">
                    {c}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <Tooltip x={m.l + hover * gw + gw / 2} width={W}>
              <div className="mb-0.5 text-muted-foreground">TC {categories[hover]}</div>
              {series.map((s, k) => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: PALETTE[k] }} />
                  <span className="tabular font-semibold">{format(s.values[hover])}</span>
                  <span className="text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </Tooltip>
          )}
        </div>
      )}
      {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
    </div>
  );
}

/** Single-series histogram. */
export function Histogram({ bins, format, caption }: { bins: readonly { from: number; to: number; count: number }[]; format: (v: number) => string; caption?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 200;
  const m = { l: 36, r: 8, t: 10, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = Math.max(1, ...bins.map((b) => b.count));
  const total = bins.reduce((a, b) => a + b.count, 0);
  const bw = iw / bins.length;
  const zeroAt = bins.findIndex((b) => b.from <= 0 && b.to > 0);
  return (
    <div className="space-y-1">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={caption}>
          <line x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} stroke="currentColor" className="text-border" />
          {bins.map((b, i) => {
            const h = (b.count / max) * ih;
            return (
              <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={m.l + i * bw} y={m.t} width={bw} height={ih} fill="transparent" />
                {h > 0 && <rect x={m.l + i * bw + 1} y={m.t + ih - h} width={bw - 2} height={h} rx={2} fill={b.to <= 0 ? PALETTE[1] : PALETTE[0]} opacity={hover === null || hover === i ? 1 : 0.6} />}
              </g>
            );
          })}
          {zeroAt >= 0 && <line x1={m.l + zeroAt * bw} x2={m.l + zeroAt * bw} y1={m.t} y2={m.t + ih} stroke="currentColor" strokeDasharray="3 3" className="text-muted-foreground/60" />}
          <text x={m.l} y={H - 8} fontSize={10} className="fill-muted-foreground">
            {format(bins[0]?.from ?? 0)}
          </text>
          <text x={m.l + iw} y={H - 8} fontSize={10} textAnchor="end" className="fill-muted-foreground">
            {format(bins.at(-1)?.to ?? 0)}
          </text>
        </svg>
        {hover !== null && (
          <Tooltip x={m.l + hover * bw + bw / 2} width={W}>
            <div className="tabular font-semibold">
              {bins[hover].count} sessions ({((bins[hover].count / total) * 100).toFixed(1)}%)
            </div>
            <div className="text-muted-foreground">
              {format(bins[hover].from)} to {format(bins[hover].to)}
            </div>
          </Tooltip>
        )}
      </div>
      {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
    </div>
  );
}

/** Sample bankroll paths with the 10th/50th/90th percentile across them. */
export function PathsChart({ paths, every, start, format }: { paths: readonly (readonly number[])[]; every: number; start: number; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!paths.length) return null;
  const W = 640;
  const H = 220;
  const m = { l: 52, r: 8, t: 10, b: 24 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const len = Math.max(...paths.map((p) => p.length));
  const all = paths.flat();
  const lo = Math.min(0, ...all);
  const hi = Math.max(start, ...all);
  const x = (i: number) => m.l + (i / Math.max(1, len - 1)) * iw;
  const y = (v: number) => m.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const pct = (i: number, q: number) => {
    const vs = paths.map((p) => p[Math.min(i, p.length - 1)]).sort((a, b) => a - b);
    return vs[Math.floor(q * (vs.length - 1))];
  };
  const line = (q: number) => Array.from({ length: len }, (_, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(pct(i, q)).toFixed(1)}`).join("");
  return (
    <div className="space-y-2">
      <Legend
        items={[
          { label: "Individual sessions", color: "#8b8f98", kind: "line" },
          { label: "Median across shown sessions", color: PALETTE[0], kind: "line" },
          { label: "10th / 90th percentile", color: PALETTE[2], kind: "line" },
        ]}
      />
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bankroll trajectories">
          {[lo, start, hi].map((v) => (
            <g key={v}>
              <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke="currentColor" strokeDasharray={v === start ? "4 3" : undefined} className="text-border" />
              <text x={m.l - 6} y={y(v)} fontSize={10} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground">
                {format(v)}
              </text>
            </g>
          ))}
          {paths.map((p, k) => (
            <path key={k} d={p.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")} fill="none" stroke="#8b8f98" strokeOpacity={0.35} strokeWidth={1} />
          ))}
          <path d={line(0.1)} fill="none" stroke={PALETTE[2]} strokeWidth={1.5} />
          <path d={line(0.9)} fill="none" stroke={PALETTE[2]} strokeWidth={1.5} />
          <path d={line(0.5)} fill="none" stroke={PALETTE[0]} strokeWidth={2} />
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="currentColor" className="text-muted-foreground/50" />}
          <text x={m.l} y={H - 6} fontSize={10} className="fill-muted-foreground">
            0
          </text>
          <text x={m.l + iw} y={H - 6} fontSize={10} textAnchor="end" className="fill-muted-foreground">
            {((len - 1) * every).toLocaleString()} rounds
          </text>
          <rect
            x={m.l}
            y={m.t}
            width={iw}
            height={ih}
            fill="transparent"
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHover(Math.max(0, Math.min(len - 1, Math.round(((e.clientX - r.left) / r.width) * (len - 1)))));
            }}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null && (
          <Tooltip x={x(hover)} width={W}>
            <div className="text-muted-foreground">After {(hover * every).toLocaleString()} rounds</div>
            {[0.9, 0.5, 0.1].map((q) => (
              <div key={q} className="tabular">
                <span className="font-semibold">{format(pct(hover, q))}</span> <span className="text-muted-foreground">{q * 100}th pct</span>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** Point estimates with 95% intervals, one row per item. */
export function IntervalChart({ rows, format, caption }: { rows: readonly { label: string; estimate: number; low: number; high: number }[]; format: (v: number) => string; caption?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const rowH = 26;
  const m = { l: 120, r: 16, t: 8, b: 22 };
  const H = m.t + m.b + rows.length * rowH;
  const iw = W - m.l - m.r;
  const lo = Math.min(0, ...rows.map((r) => r.low));
  const hi = Math.max(0, ...rows.map((r) => r.high));
  const x = (v: number) => m.l + ((v - lo) / (hi - lo || 1)) * iw;
  return (
    <div className="space-y-1">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={caption}>
          <line x1={x(0)} x2={x(0)} y1={m.t} y2={H - m.b} stroke="currentColor" strokeDasharray="3 3" className="text-muted-foreground/60" />
          {rows.map((r, i) => {
            const cy = m.t + i * rowH + rowH / 2;
            return (
              <g key={r.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill="transparent" />
                <text x={m.l - 8} y={cy} fontSize={11} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground">
                  {r.label}
                </text>
                <line x1={x(r.low)} x2={x(r.high)} y1={cy} y2={cy} stroke={PALETTE[0]} strokeWidth={2} strokeLinecap="round" />
                <circle cx={x(r.estimate)} cy={cy} r={hover === i ? 5 : 4} fill={PALETTE[0]} stroke="var(--card)" strokeWidth={2} />
              </g>
            );
          })}
          <text x={x(lo)} y={H - 6} fontSize={10} className="fill-muted-foreground">
            {format(lo)}
          </text>
          <text x={x(0)} y={H - 6} fontSize={10} textAnchor="middle" className="fill-muted-foreground">
            0
          </text>
          <text x={x(hi)} y={H - 6} fontSize={10} textAnchor="end" className="fill-muted-foreground">
            {format(hi)}
          </text>
        </svg>
        {hover !== null && (
          <Tooltip x={x(rows[hover].estimate)} width={W}>
            <div className="tabular font-semibold">{format(rows[hover].estimate)}</div>
            <div className="tabular text-muted-foreground">
              95% CI {format(rows[hover].low)} to {format(rows[hover].high)}
            </div>
          </Tooltip>
        )}
      </div>
      {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
    </div>
  );
}
