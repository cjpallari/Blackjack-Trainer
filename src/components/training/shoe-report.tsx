"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Segmented, StatTile, pct } from "@/components/training/controls";
import { formatCount } from "@/lib/blackjack/counting";
import { parseScenarioKey } from "@/lib/training/basic-strategy";
import { ACTION_LABEL } from "@/lib/training/explain";
import { MODE_LABELS } from "@/lib/training/table/modes";
import { TERMINATION_LABEL, type ShoeReport } from "@/lib/training/table/shoe-tracker";
import { cn } from "@/lib/utils";

/** Validated categorical slots on the dark surface (see dataviz palette): blue = actual, orange = player. */
const ACTUAL = "#3987e5";
const PLAYER = "#d95926";

const fmt1 = (n: number | null) => (n === null ? "—" : n.toFixed(1));
const signed1 = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`);

export function ShoeReportView({ report: r }: { report: ShoeReport }) {
  const c = r.counting;
  const s = r.strategy;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Shoe report</h2>
          <p className="text-xs text-muted-foreground">
            {new Date(r.endedAt).toLocaleString()} · {r.rulesSummary} · {r.modes.map((m) => MODE_LABELS[m]).join(" → ")} mode
          </p>
        </div>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs", r.completedNormally ? "bg-success/15 text-success" : "bg-amber-500/15 text-amber-300")}>
          {TERMINATION_LABEL[r.termination]}
        </span>
      </div>

      {!c.valid && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {c.invalidReason}
        </p>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Counting</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Final count" value={c.finalSubmitted === null ? "Not given" : formatCount(c.finalSubmitted)} sub={`actual ${formatCount(c.finalActual)}`} />
          <StatTile label="Checks correct" value={`${c.correct}/${c.answered}`} sub={c.checkpoints > c.answered ? `${c.checkpoints - c.answered} skipped` : `${c.checkpoints} checks`} />
          <StatTile label="Avg RC error" value={fmt1(c.avgAbsRcError)} sub="absolute, answered checks" />
          <StatTile label="True count" value={c.tcAnswered ? `${c.tcCorrect}/${c.tcAnswered}` : "—"} sub={`avg |error| ${fmt1(c.avgAbsTcError)}`} />
          <StatTile label="Deck estimates" value={c.deckEstimates ? `${c.deckCorrect}/${c.deckEstimates}` : "—"} sub="within tolerance" />
          <StatTile label="TC arithmetic" value={c.arithmeticChecked ? `${c.arithmeticCorrect}/${c.arithmeticChecked}` : "—"} sub="from your own RC & decks" />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Strategy</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile
            label={s.grading === "count-adjusted" ? "Count-adjusted accuracy" : "Accuracy"}
            value={pct(s.accuracy, 1)}
            sub={`${s.correct}/${s.graded} graded decisions`}
          />
          <StatTile label="Mistakes" value={s.incorrect} sub={s.ungraded ? `${s.ungraded} not graded` : `${s.basicMatches} matched basic strategy`} />
          <StatTile label="Est. EV lost" value={`${(s.estimatedEvLost * 100).toFixed(1)}%`} sub="basic-strategy mistakes only" />
          <StatTile label="Approximate grades" value={s.approximate} sub="multi-card / split hands" />
        </div>
        {s.topMisses.length > 0 && (
          <table className="tabular w-full max-w-lg text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Missed</th>
                <th className="py-1 font-medium">Times</th>
                <th className="py-1 font-medium">You</th>
                <th className="py-1 font-medium">Correct</th>
              </tr>
            </thead>
            <tbody>
              {s.topMisses.map((m) => {
                const { row, up } = parseScenarioKey(m.key);
                return (
                  <tr key={m.key} className="border-t border-border">
                    <td className="py-1 capitalize">
                      {row} <span className="text-muted-foreground normal-case">v {up}</span>
                    </td>
                    <td className="py-1">{m.count}</td>
                    <td className="py-1 text-destructive">{ACTION_LABEL[m.chosen]}</td>
                    <td className="py-1 text-success">{ACTION_LABEL[m.best]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-[11px] text-muted-foreground">
          EV losses are estimates from the basic-strategy tables. Multi-card hands, hands after a split, and split decisions are graded with
          approximations. Index plays are graded right or wrong only: the EV gained or lost by a deviation at a given count is not calculated.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Count-based deviations</h3>
        {r.deviations ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Opportunities" value={r.deviations.opportunities} sub="count called for a deviation" />
              <StatTile label="Made" value={r.deviations.followed} sub={r.deviations.opportunities ? pct(r.deviations.followed / r.deviations.opportunities) : " "} />
              <StatTile label="Missed" value={r.deviations.missed} sub="played basic instead" />
              <StatTile label="Not due" value={r.deviations.wrongDeviations} sub="index play made too early" />
            </div>
            {r.deviations.byCell.length > 0 && (
              <table className="tabular w-full max-w-lg text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">Index</th>
                    <th className="py-1 font-medium">Correct</th>
                    <th className="py-1 font-medium">Due</th>
                    <th className="py-1 font-medium">Missed</th>
                    <th className="py-1 font-medium">Not due</th>
                  </tr>
                </thead>
                <tbody>
                  {r.deviations.byCell.map((c) => (
                    <tr key={c.cellId} className="border-t border-border">
                      <td className="py-1">{c.label}</td>
                      <td className="py-1">
                        {c.correct}/{c.decisions}
                      </td>
                      <td className="py-1">{c.opportunities}</td>
                      <td className={cn("py-1", c.missed && "text-destructive")}>{c.missed}</td>
                      <td className={cn("py-1", c.wrong && "text-destructive")}>{c.wrong}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[11px] text-muted-foreground">
              Graded with {r.deviations.indexSetId} using your visible running count and a quarter-deck estimate of the undealt cards
              {r.deviations.borderline ? `; ${r.deviations.borderline} borderline decision(s) accepted either way` : ""}.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Not graded. {r.deviationsNote}</p>
        )}
        {r.insurance && (
          <p className="tabular text-xs text-muted-foreground">
            Insurance: offered {r.insurance.offered} · taken {r.insurance.taken} · {r.insurance.correct}/{r.insurance.offered} correct decisions · net{" "}
            {r.insurance.net > 0 ? "+" : ""}
            {r.insurance.net} (settled separately from hands)
          </p>
        )}
      </section>

      {r.betting && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Betting (ramp: {r.betting.rampName})</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Bets matching ramp" value={`${r.betting.correct}/${r.betting.decisions}`} sub={pct(r.betting.correct / r.betting.decisions, 0)} />
          </div>
          {r.betting.misses.length > 0 && (
            <p className="tabular text-xs text-muted-foreground">
              Off-ramp bets:{" "}
              {r.betting.misses
                .map((m) => `round ${m.round} at TC ${m.trueCount > 0 ? "+" : ""}${m.trueCount}: bet ${m.chosen}, ramp ${m.recommended}`)
                .join("; ")}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">Graded separately from playing strategy and counting; an off-ramp bet is not a playing mistake.</p>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Shoe</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Rounds" value={r.shoe.rounds} />
          <StatTile label="Cards dealt" value={`${r.shoe.cardsDealt}/${r.shoe.totalCards}`} sub={`${Math.round(r.shoe.finalPenetration * 100)}% penetration`} />
          <StatTile label="Max true count" value={signed1(r.shoe.maxTrueCount)} sub="after a round" />
          <StatTile label="Min true count" value={signed1(r.shoe.minTrueCount)} sub="after a round" />
        </div>
        <CountChart report={r} />
      </section>
    </div>
  );
}

export function CountChart({ report: r }: { report: ShoeReport }) {
  const [metric, setMetric] = useState<"tc" | "rc">("tc");
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const line = r.progression.map((p) => ({ x: p.cardsDealt, y: metric === "tc" ? p.trueCount : p.runningCount, round: p.round }));
  const dots = r.estimates
    .map((e) => ({ x: e.cardsDealt, est: metric === "tc" ? e.estimatedTc : e.estimatedRc, actual: metric === "tc" ? e.actualTc : e.actualRc, round: e.round }))
    .filter((d): d is { x: number; est: number; actual: number; round: number } => d.est !== null && d.actual !== null);

  const W = 640;
  const H = 220;
  const m = { l: 34, r: 12, t: 12, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const ys = [...line.map((p) => p.y), ...dots.map((d) => d.est), 0];
  const span = Math.max(2, Math.ceil(Math.max(...ys.map(Math.abs)) + 0.5));
  const x = (v: number) => m.l + (v / r.shoe.totalCards) * iw;
  const y = (v: number) => m.t + ((span - v) / (2 * span)) * ih;
  const path = line.map((p, i) => `${i ? "L" : "M"}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  const ticks = [-span, -Math.round(span / 2), 0, Math.round(span / 2), span].filter((v, i, a) => a.indexOf(v) === i);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cards = ((e.clientX - rect.left) / rect.width) * r.shoe.totalCards;
    let best = 0;
    line.forEach((p, i) => {
      if (Math.abs(p.x - cards) < Math.abs(line[best].x - cards)) best = i;
    });
    setHover(best);
  };
  const hp = hover !== null ? line[hover] : null;
  const hDot = hp ? dots.find((d) => d.round === hp.round) : undefined;
  const label = metric === "tc" ? "True count" : "Running count";

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: ACTUAL }} />
            Actual {label.toLowerCase()} (after each round)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: PLAYER }} />
            Your answers at checks
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            value={metric}
            onChange={setMetric}
            options={[
              { value: "tc", label: "True count" },
              { value: "rc", label: "Running count" },
            ]}
          />
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setTable((v) => !v)}>
            {table ? "Chart" : "Table"}
          </button>
        </div>
      </div>

      {table ? (
        <div className="max-h-56 overflow-auto">
          <table className="tabular w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Round</th>
                <th className="py-1 font-medium">Cards dealt</th>
                <th className="py-1 font-medium">Actual</th>
                <th className="py-1 font-medium">Your answer</th>
              </tr>
            </thead>
            <tbody>
              {line.map((p) => {
                const d = dots.find((q) => q.round === p.round);
                return (
                  <tr key={p.round} className="border-t border-border">
                    <td className="py-1">{p.round || "start"}</td>
                    <td className="py-1">{p.x}</td>
                    <td className="py-1">{metric === "tc" ? signed1(p.y) : formatCount(p.y)}</td>
                    <td className="py-1">{d ? (metric === "tc" ? signed1(d.est) : formatCount(d.est)) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label} over the shoe`}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke="currentColor" className={v === 0 ? "text-muted-foreground/40" : "text-border"} />
                <text x={m.l - 6} y={y(v)} fontSize={10} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground">
                  {v > 0 ? `+${v}` : v}
                </text>
              </g>
            ))}
            <text x={m.l} y={H - 6} fontSize={10} className="fill-muted-foreground">
              0 cards
            </text>
            <text x={m.l + iw} y={H - 6} fontSize={10} textAnchor="end" className="fill-muted-foreground">
              {r.shoe.totalCards} cards
            </text>
            {hp && <line x1={x(hp.x)} x2={x(hp.x)} y1={m.t} y2={m.t + ih} stroke="currentColor" className="text-muted-foreground/50" />}
            <path d={path} fill="none" stroke={ACTUAL} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hp && <circle cx={x(hp.x)} cy={y(hp.y)} r={4} fill={ACTUAL} stroke="var(--card)" strokeWidth={2} />}
            {/* Measured answers only: separate markers, never joined into a line. */}
            {dots.map((d, i) => (
              <circle key={i} cx={x(d.x)} cy={y(d.est)} r={4.5} fill={PLAYER} stroke="var(--card)" strokeWidth={2} />
            ))}
            <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
          {hp && (
            <div
              className={cn(
                "pointer-events-none absolute top-1 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg",
                x(hp.x) > W / 2 ? "-translate-x-[calc(100%+8px)]" : "translate-x-2",
              )}
              style={{ left: `${(x(hp.x) / W) * 100}%` }}
            >
              <div className="text-muted-foreground">
                {hp.round ? `After round ${hp.round}` : "Start"} · {hp.x} cards
              </div>
              <div className="flex items-center gap-2">
                <span className="h-0.5 w-3 rounded-full" style={{ background: ACTUAL }} />
                <span className="font-semibold">{metric === "tc" ? signed1(hp.y) : formatCount(hp.y)}</span>
                <span className="text-muted-foreground">actual</span>
              </div>
              {hDot && (
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: PLAYER }} />
                  <span className="font-semibold">{metric === "tc" ? signed1(hDot.est) : formatCount(hDot.est)}</span>
                  <span className="text-muted-foreground">your answer</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        The blue line is the engine&apos;s exact count. Orange dots are the answers you gave at checkpoints; nothing is assumed about your count
        between them. Checks taken mid-round are plotted at that moment&apos;s card total.
        {r.estimates.length > 0 && r.estimates.every((e) => e.estimatedRc === null) ? " You skipped every check this shoe." : ""}
        {metric === "tc" && dots.length === 0 && r.estimates.some((e) => e.estimatedRc !== null) ? " No true-count answers were given; switch to Running count to see your answers." : ""}
      </p>
    </div>
  );
}
