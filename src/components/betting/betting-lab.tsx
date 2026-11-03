"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Minus, Play, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Segmented, StatTile } from "@/components/training/controls";
import { GroupedBars, Histogram, IntervalChart, PathsChart } from "@/components/betting/charts";
import { useSettings } from "@/hooks/use-store";
import { useSimulation } from "@/hooks/use-simulation";
import { ROUNDING_LABELS } from "@/lib/blackjack/counting";
import { describeRules } from "@/lib/blackjack/rules";
import { describeRamp, RAMP_PRESETS, spreadOf, validateRamp, type BettingRamp } from "@/lib/betting/ramp";
import { approximateEventualRor, type CompareResult, type EvSummary, type PenetrationRow, type RorSummary } from "@/lib/sim/analyses";
import { TC_BINS, type SimConfig } from "@/lib/sim/simulate";
import type { Interval } from "@/lib/sim/stats";
import { cn } from "@/lib/utils";

const PENETRATIONS = [0.5, 0.6, 0.65, 0.7, 0.71, 0.75];
const ROUND_SIZES = [50_000, 100_000, 300_000, 1_000_000, 3_000_000];
const BANKROLLS = [1000, 2500, 5000, 10000];

const money = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 })}`;
const pct = (v: number, d = 2) => `${v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%`;
const ciPct = (i: Interval, d = 2) => `${pct(i.estimate, d)} (95% CI ${pct(i.low, d)} to ${pct(i.high, d)})`;
const ciMoney = (i: Interval) => `${money(i.estimate)} (${money(i.low)} to ${money(i.high)})`;

type Tab = "ev" | "compare" | "ror" | "penetration";

export function BettingLab() {
  const [settings, setSettings] = useSettings();
  const b = settings.betting;
  const rules = settings.rules;
  const setB = (patch: Partial<typeof b>) => setSettings((s) => ({ ...s, betting: { ...s.betting, ...patch } }));
  const [tab, setTab] = useState<Tab>("ev");

  const sim: SimConfig = useMemo(
    () => ({
      rules: { ...rules, penetration: b.penetration },
      otherPlayers: b.otherPlayers,
      seat: Math.min(b.seat, b.otherPlayers),
      ramp: b.ramp,
      limits: b.limits,
      convention: settings.rounding,
      play: b.play,
    }),
    [rules, b, settings.rounding],
  );
  const errors = validateRamp(b.ramp, b.limits, b.otherPlayers > 0);

  return (
    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <RampEditor ramp={b.ramp} onChange={(ramp) => setB({ ramp })} limits={b.limits} onLimits={(limits) => setB({ limits })} errors={errors} />
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-semibold">Game and simulation</div>
          <p className="text-xs text-muted-foreground">
            {describeRules(rules)}.{" "}
            <Link href="/settings" className="text-primary hover:underline">
              Change rules
            </Link>
          </p>
          <Field label={`Cut-card penetration: ${(b.penetration * 100).toFixed(0)}% (card ${Math.round(rules.decks * 52 * b.penetration)} of ${rules.decks * 52})`}>
            <input
              type="range"
              min={40}
              max={85}
              value={Math.round(b.penetration * 100)}
              onChange={(e) => setB({ penetration: Number(e.target.value) / 100 })}
              className="w-full accent-[var(--primary)]"
            />
            <div className="flex flex-wrap gap-1">
              {PENETRATIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setB({ penetration: p })}
                  className={cn("rounded border px-1.5 text-[11px]", b.penetration === p ? "border-primary text-primary" : "border-border text-muted-foreground")}
                >
                  {Math.round(p * 100)}%
                </button>
              ))}
            </div>
            {rules.decks === 2 && (
              <p className="text-[11px] text-muted-foreground">
                71% ≈ cut card 30 cards from the bottom of two decks. That rule is a reported observation about one casino, not a verified rule.
              </p>
            )}
          </Field>
          <Field label="Other players">
            <Segmented value={b.otherPlayers} onChange={(otherPlayers) => setB({ otherPlayers })} options={[0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: n }))} />
          </Field>
          <Field label="Playing strategy">
            <Segmented
              value={b.play}
              onChange={(play) => setB({ play })}
              options={[
                { value: "basic", label: "Basic strategy" },
                { value: "deviations", label: "+ validated indices" },
              ]}
            />
          </Field>
          <Field label="Rounds per run">
            <Segmented value={b.rounds} onChange={(rounds) => setB({ rounds })} options={ROUND_SIZES.map((n) => ({ value: n, label: n >= 1e6 ? `${n / 1e6}M` : `${n / 1000}k` }))} />
          </Field>
          <Field label="Hands per hour (assumption)" hint="Illustrative only; real speed depends on the dealer, players and shuffle.">
            <input
              type="number"
              min={20}
              max={300}
              value={b.roundsPerHour}
              onChange={(e) => setB({ roundsPerHour: Math.max(20, Math.min(300, Number(e.target.value) || 100)) })}
              className="tabular h-8 w-24 rounded-lg border border-input bg-input/30 px-2 text-sm"
            />
          </Field>
          <Field label="Seed" hint="Same seed and settings give identical results.">
            <input
              type="number"
              value={b.seed}
              onChange={(e) => setB({ seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              className="tabular h-8 w-28 rounded-lg border border-input bg-input/30 px-2 text-sm"
            />
          </Field>
          <p className="text-[11px] text-muted-foreground">True-count rounding: {ROUNDING_LABELS[settings.rounding]} (Settings).</p>
        </div>
        <Disclaimer />
      </aside>

      <div className="min-w-0 space-y-4">
        <Segmented
          size="md"
          value={tab}
          onChange={setTab}
          options={[
            { value: "ev", label: "Expected value" },
            { value: "compare", label: "Spread comparison" },
            { value: "ror", label: "Risk of ruin" },
            { value: "penetration", label: "Penetration" },
          ]}
        />
        {errors.length > 0 && <p className="text-sm text-destructive">{errors.join(" ")}</p>}
        <div className={tab === "ev" ? "" : "hidden"}>
          <EvPanel sim={sim} rounds={b.rounds} seed={b.seed} roundsPerHour={b.roundsPerHour} disabled={errors.length > 0} />
        </div>
        <div className={tab === "compare" ? "" : "hidden"}>
          <ComparePanel sim={sim} rounds={b.rounds} seed={b.seed} roundsPerHour={b.roundsPerHour} disabled={errors.length > 0} />
        </div>
        <div className={tab === "ror" ? "" : "hidden"}>
          <RorPanel sim={sim} seed={b.seed} roundsPerHour={b.roundsPerHour} disabled={errors.length > 0} />
        </div>
        <div className={tab === "penetration" ? "" : "hidden"}>
          <PenetrationPanel sim={sim} rounds={b.rounds} seed={b.seed} roundsPerHour={b.roundsPerHour} disabled={errors.length > 0} />
        </div>
      </div>
    </div>
  );
}

function Disclaimer() {
  return (
    <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs leading-relaxed text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
      <div className="space-y-1.5">
        <p>
          These simulations model <strong className="text-foreground">conventional</strong> blackjack with the rules above. They say nothing about
          Blackjack Elite or any other non-standard game, whose rules are not modelled.
        </p>
        <p>
          Expected value is a long-run average. Short sessions are dominated by variance: a winning simulated session does not show an edge, and a
          positive estimate is only meaningful when its confidence interval excludes zero.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RampEditor({
  ramp,
  onChange,
  limits,
  onLimits,
  errors,
}: {
  ramp: BettingRamp;
  onChange: (r: BettingRamp) => void;
  limits: SimConfig["limits"];
  onLimits: (l: SimConfig["limits"]) => void;
  errors: string[];
}) {
  const num = (v: string, min = 0) => Math.max(min, Number(v) || 0);
  const setStep = (i: number, patch: Partial<BettingRamp["steps"][number]>) =>
    onChange({ ...ramp, id: "custom", name: "Custom", steps: ramp.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Betting ramp</div>
        <span className="text-xs text-muted-foreground">
          {ramp.name} · {spreadOf(ramp)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {RAMP_PRESETS.map((p) => (
          <Button key={p.id} size="sm" variant={ramp.id === p.id ? "default" : "secondary"} onClick={() => onChange({ ...p, unit: ramp.unit })}>
            {p.name}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <label className="space-y-1">
          <span className="text-muted-foreground">Unit ($)</span>
          <NumberBox value={ramp.unit} onChange={(v) => onChange({ ...ramp, unit: num(v, 1) })} />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Table min</span>
          <NumberBox value={limits.tableMin} onChange={(v) => onLimits({ ...limits, tableMin: num(v, 1) })} />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Table max</span>
          <NumberBox value={limits.tableMax} onChange={(v) => onLimits({ ...limits, tableMax: num(v, 1) })} />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Chip size</span>
          <NumberBox value={limits.chip} onChange={(v) => onLimits({ ...limits, chip: num(v, 1) })} />
        </label>
        <label className="col-span-2 space-y-1">
          <span className="text-muted-foreground">Units below first step (0 = sit out)</span>
          <NumberBox value={ramp.baseUnits} onChange={(v) => onChange({ ...ramp, id: "custom", name: "Custom", baseUnits: num(v) })} />
        </label>
      </div>
      <table className="tabular w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">True count ≥</th>
            <th className="py-1 font-medium">Units</th>
            <th className="py-1 font-medium">Bet</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ramp.steps.map((s, i) => (
            <tr key={i} className="border-t border-border">
              <td className="py-1">
                <NumberBox value={s.minTc} onChange={(v) => setStep(i, { minTc: Math.round(Number(v) || 0) })} allowNegative />
              </td>
              <td className="py-1">
                <NumberBox value={s.units} onChange={(v) => setStep(i, { units: num(v) })} />
              </td>
              <td className="py-1">{money(s.units * ramp.unit)}</td>
              <td className="py-1 text-right">
                <button
                  type="button"
                  aria-label="Remove step"
                  onClick={() => onChange({ ...ramp, id: "custom", name: "Custom", steps: ramp.steps.filter((_, k) => k !== i) })}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Minus className="size-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        size="sm"
        variant="ghost"
        className="gap-1"
        onClick={() => {
          const last = ramp.steps.at(-1);
          onChange({ ...ramp, id: "custom", name: "Custom", steps: [...ramp.steps, { minTc: (last?.minTc ?? 1) + 1, units: (last?.units ?? ramp.baseUnits) + 1 }] });
        }}
      >
        <Plus className="size-3.5" /> Add step
      </Button>
      <p className="text-[11px] text-muted-foreground">{describeRamp(ramp)}</p>
      <p className="text-[11px] text-muted-foreground">
        Bets use only what you could see before the deal: the running count of exposed cards and a quarter-deck estimate of the cards left. They
        are rounded down to the chip size and capped by table limits and your bankroll.
      </p>
      {errors.length > 0 && <p className="text-xs text-destructive">{errors[0]}</p>}
    </div>
  );
}

function NumberBox({ value, onChange, allowNegative }: { value: number; onChange: (v: string) => void; allowNegative?: boolean }) {
  return (
    <input
      type="number"
      value={value}
      min={allowNegative ? undefined : 0}
      onChange={(e) => onChange(e.target.value)}
      className="tabular h-7 w-full rounded-md border border-input bg-input/30 px-1.5 text-sm"
    />
  );
}

// ---------------------------------------------------------------------------

function RunBar({
  label,
  status,
  progress,
  runtimeMs,
  onRun,
  onCancel,
  disabled,
  detail,
}: {
  label: string;
  status: string;
  progress: number;
  runtimeMs: number | null;
  onRun: () => void;
  onCancel: () => void;
  disabled?: boolean;
  detail: string;
}) {
  const running = status === "running";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
      {running ? (
        <Button variant="secondary" onClick={onCancel} className="gap-2">
          <Square className="size-3.5" /> Cancel
        </Button>
      ) : (
        <Button onClick={onRun} disabled={disabled} className="gap-2">
          <Play className="size-3.5" /> {label}
        </Button>
      )}
      <div className="min-w-40 flex-1">
        <div className="text-xs text-muted-foreground">{detail}</div>
        {running && (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <span className="tabular text-xs text-muted-foreground">
        {running ? `${Math.round(progress * 100)}%` : status === "cancelled" ? "Cancelled" : runtimeMs !== null ? `Finished in ${(runtimeMs / 1000).toFixed(1)}s` : ""}
      </span>
    </div>
  );
}

function EvPanel({ sim, rounds, seed, roundsPerHour, disabled }: { sim: SimConfig; rounds: number; seed: number; roundsPerHour: number; disabled: boolean }) {
  const { run, start, cancel } = useSimulation<EvSummary>();
  const r = run.result;
  return (
    <div className="space-y-4">
      <RunBar
        label="Run expected value"
        status={run.status}
        progress={run.progress}
        runtimeMs={run.runtimeMs}
        onRun={() => start({ kind: "ev", req: { sim, rounds, seed, roundsPerHour } })}
        onCancel={cancel}
        disabled={disabled}
        detail={`${rounds.toLocaleString()} rounds, unlimited bankroll, seed ${seed}`}
      />
      {run.error && <p className="text-sm text-destructive">{run.error}</p>}
      {r && <EvResults r={r} />}
    </div>
  );
}

function EvResults({ r }: { r: EvSummary }) {
  const significant = r.edgeOnInitial.low > 0 ? "positive" : r.edgeOnInitial.high < 0 ? "negative" : "undetermined";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatTile label="Edge on initial wagers" value={pct(r.edgeOnInitial.estimate)} sub={`95% CI ${pct(r.edgeOnInitial.low)} to ${pct(r.edgeOnInitial.high)}`} />
        <StatTile label="Return on all money wagered" value={pct(r.returnOnTotal.estimate)} sub="incl. doubles, splits, insurance" />
        <StatTile label="Per 100 rounds" value={money(r.per100.estimate)} sub={`${money(r.per100.low)} to ${money(r.per100.high)}`} />
        <StatTile label="Per hour (assumed)" value={money(r.perHour.estimate)} sub={`at ${r.roundsPerHour} rounds/hour`} />
        <StatTile label="SD per 100 rounds" value={money(r.sdPer100)} sub={`per round ${money(r.sdRound)}`} />
        <StatTile label="Average initial bet" value={money(r.avgInitialBet)} sub={`at risk per round ${money(r.avgAtRisk)}`} />
        <StatTile label="Rounds" value={r.roundsPlayed.toLocaleString()} sub={`${r.shoes.toLocaleString()} shoes · ${Math.round(r.roundsPerSecond).toLocaleString()} rounds/s`} />
        <StatTile label="Net result" value={money(r.net)} sub={`on ${money(r.initialWagered)} initial wagers`} />
      </div>
      <p className={cn("text-sm", significant === "positive" ? "text-success" : significant === "negative" ? "text-destructive" : "text-muted-foreground")}>
        {significant === "positive"
          ? "The 95% interval is above zero: this run supports a positive expectation for this configuration."
          : significant === "negative"
            ? "The 95% interval is below zero: this configuration has a negative expectation."
            : "The 95% interval includes zero: this run cannot tell whether the expectation is positive or negative. Run more rounds."}
      </p>
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold">Pre-bet true counts</h3>
        <GroupedBars
          categories={TC_BINS}
          series={[
            { label: "% of betting opportunities", values: r.bins.map((b) => b.opportunityShare) },
            { label: "% of initial wagers", values: r.bins.map((b) => b.wagerShare) },
          ]}
          format={(v) => pct(v, 1)}
          caption="Observed in this simulation (not a theoretical curve). High counts are rare but carry a large share of the money when the ramp raises bets."
        />
        <table className="tabular mt-3 w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">TC</th>
              {r.bins.map((b) => (
                <th key={b.label} className="py-1 font-medium">
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="py-1 text-muted-foreground">Edge in bin*</td>
              {r.bins.map((b) => (
                <td key={b.label} className="py-1">
                  {b.edgeOnInitial === null ? "—" : pct(b.edgeOnInitial, 1)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-muted-foreground">* Point estimates without intervals; individual bins are very noisy unless the run is large.</p>
      </div>
      <Definitions r={r} />
    </div>
  );
}

function Definitions({ r }: { r: EvSummary }) {
  return (
    <details className="rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
      <summary className="cursor-pointer text-sm font-medium text-foreground">Definitions and details</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        <li>
          <strong>Edge on initial wagers</strong> = net result ÷ sum of initial bets (the bet placed before the deal). This is the usual “player edge”.
        </li>
        <li>
          <strong>Return on all money wagered</strong> = net ÷ (initial bets + extra money for doubles and splits + insurance). It is smaller in magnitude
          and is not the edge.
        </li>
        <li>
          Intervals are 95%, using whole shoes as independent units because hands in the same shoe share a count. SD per 100 rounds uses the same
          shoe-level variance; the per-round SD treats rounds individually.
        </li>
        <li>
          Additional wagers (doubles and splits): {money(r.additionalWagered)}; insurance staked {money(r.insuranceWagered)} (net {money(r.insuranceNet)}).
          Validated index plays used: {r.deviationsApplied.toLocaleString()}; index plays that fell back to basic strategy because no validated index
          exists: {r.deviationFallbacks.toLocaleString()}.
        </li>
        <li>
          Cut card at card {r.penetration.cutCardIndex} ({pct(r.penetration.cutFraction, 0)}); because the round in progress is always finished, an
          average of {r.penetration.avgCardsDealtPerShoe?.toFixed(1)} cards ({pct(r.penetration.avgDealtFraction ?? 0, 1)}) were dealt per shoe, over{" "}
          {r.penetration.roundsPerShoe?.toFixed(2)} rounds.
        </li>
        <li>
          Shoes interrupted by running out mid-round: {r.invalidShoes} ({r.invalidRounds} rounds), excluded from the estimates. Seed {r.seed}.
        </li>
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------

type CompareJobResult = { compare: CompareResult; ror: RorSummary[] | null };

function ComparePanel({ sim, rounds, seed, roundsPerHour, disabled }: { sim: SimConfig; rounds: number; seed: number; roundsPerHour: number; disabled: boolean }) {
  const [settings] = useSettings();
  const { run, start, cancel } = useSimulation<CompareJobResult>();
  const [picked, setPicked] = useState<string[]>(["flat", "1-2", "1-4", "1-8"]);
  const [withRor, setWithRor] = useState(false);
  const b = settings.betting;
  const ramps = [...RAMP_PRESETS.filter((r) => picked.includes(r.id)).map((r) => ({ ...r, unit: sim.ramp.unit })), ...(sim.ramp.id === "custom" ? [sim.ramp] : [])];
  const res = run.result;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {RAMP_PRESETS.map((r) => (
          <label key={r.id} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-[var(--primary)]"
              checked={picked.includes(r.id)}
              onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))}
            />
            {r.name}
          </label>
        ))}
        {sim.ramp.id === "custom" && <span className="text-xs text-muted-foreground">+ your custom ramp</span>}
        <label className="ml-auto flex items-center gap-1.5 text-xs">
          <input type="checkbox" className="accent-[var(--primary)]" checked={withRor} onChange={(e) => setWithRor(e.target.checked)} />
          Include risk of ruin ({money(b.bankroll)}, {b.horizon.toLocaleString()} rounds, {b.trials} sessions each)
        </label>
      </div>
      <RunBar
        label="Compare spreads"
        status={run.status}
        progress={run.progress}
        runtimeMs={run.runtimeMs}
        disabled={disabled || ramps.length < 2}
        onRun={() =>
          start({
            kind: "compare",
            req: { sim, ramps, rounds, seed, roundsPerHour },
            ror: withRor ? { bankroll: b.bankroll, rounds: b.horizon, trials: b.trials, profitTarget: b.profitTarget, seed, samplePaths: 0 } : undefined,
          })
        }
        onCancel={cancel}
        detail={`${ramps.length} strategies × ${rounds.toLocaleString()} rounds on the same shuffles (seed ${seed})`}
      />
      {res && (
        <div className="space-y-4">
          <div className="overflow-auto rounded-xl border border-border bg-card p-4">
            <table className="tabular w-full min-w-[720px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Strategy</th>
                  <th className="py-1 font-medium">Edge (initial)</th>
                  <th className="py-1 font-medium">Per 100 rounds</th>
                  <th className="py-1 font-medium">Per hour</th>
                  <th className="py-1 font-medium">SD / 100</th>
                  <th className="py-1 font-medium">Avg bet</th>
                  <th className="py-1 font-medium">vs first, per 100</th>
                  {res.ror && <th className="py-1 font-medium">Ruin</th>}
                  {res.ror && <th className="py-1 font-medium">Max drawdown (median / 95th)</th>}
                </tr>
              </thead>
              <tbody>
                {res.compare.rows.map((row, i) => {
                  const s = row.summary;
                  const ror = res.ror?.[i];
                  return (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="py-1.5">
                        {row.ramp.name} <span className="text-muted-foreground">({row.spread})</span>
                      </td>
                      <td className="py-1.5">{ciPct(s.edgeOnInitial)}</td>
                      <td className="py-1.5">{ciMoney(s.per100)}</td>
                      <td className="py-1.5">{money(s.perHour.estimate)}</td>
                      <td className="py-1.5">{money(s.sdPer100)}</td>
                      <td className="py-1.5">{money(s.avgInitialBet)}</td>
                      <td className="py-1.5">
                        {row.vsBaselinePer100 ? (
                          <>
                            {ciMoney(row.vsBaselinePer100)}
                            <span className={cn("block", row.distinguishable ? "text-success" : "text-muted-foreground")}>
                              {row.distinguishable ? "distinguishable" : "not distinguishable"}
                            </span>
                          </>
                        ) : (
                          "baseline"
                        )}
                      </td>
                      {ror && <td className="py-1.5">{ciPct(ror.ruin, 1)}</td>}
                      {ror && (
                        <td className="py-1.5">
                          {money(ror.drawdownPercentiles.p50)} / {money(ror.drawdownPercentiles.p95)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Expected result per 100 rounds (95% CI)</h3>
            <IntervalChart rows={res.compare.rows.map((r) => ({ label: r.ramp.name, ...r.summary.per100 }))} format={money} />
          </div>
          <p className="text-xs text-muted-foreground">
            {res.compare.note} Where two intervals overlap substantially, these runs do not show which strategy is better.
            {res.ror && " Risk-of-ruin sessions have a finite bankroll, so bankroll limits and ruin make their trajectories diverge between strategies."}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

type RorJobResult = { ror: RorSummary; ev: EvSummary };

function RorPanel({ sim, seed, roundsPerHour, disabled }: { sim: SimConfig; seed: number; roundsPerHour: number; disabled: boolean }) {
  const [settings, setSettings] = useSettings();
  const b = settings.betting;
  const setB = (patch: Partial<typeof b>) => setSettings((s) => ({ ...s, betting: { ...s.betting, ...patch } }));
  const { run, start, cancel } = useSimulation<RorJobResult>();
  const res = run.result;
  const eventual = res ? approximateEventualRor(res.ev.perRound.estimate, res.ev.sdPer100 / 10, res.ror.bankroll) : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
        <Field label="Starting bankroll">
          <div className="flex flex-wrap items-center gap-1">
            <Segmented value={BANKROLLS.includes(b.bankroll) ? b.bankroll : 0} onChange={(v) => v && setB({ bankroll: v })} options={BANKROLLS.map((n) => ({ value: n, label: `$${n.toLocaleString()}` }))} />
            <input
              type="number"
              aria-label="Custom bankroll"
              value={b.bankroll}
              min={1}
              onChange={(e) => setB({ bankroll: Math.max(1, Number(e.target.value) || 1) })}
              className="tabular h-8 w-24 rounded-lg border border-input bg-input/30 px-2 text-sm"
            />
          </div>
        </Field>
        <Field label="Session length (rounds)">
          <Segmented value={b.horizon} onChange={(horizon) => setB({ horizon })} options={[1000, 5000, 10000, 25000].map((n) => ({ value: n, label: n.toLocaleString() }))} />
        </Field>
        <Field label="Independent sessions">
          <Segmented value={b.trials} onChange={(trials) => setB({ trials })} options={[100, 200, 500, 1000].map((n) => ({ value: n, label: n }))} />
        </Field>
        <Field label="Profit target">
          <input
            type="number"
            value={b.profitTarget}
            min={1}
            onChange={(e) => setB({ profitTarget: Math.max(1, Number(e.target.value) || 1) })}
            className="tabular h-8 w-28 rounded-lg border border-input bg-input/30 px-2 text-sm"
          />
        </Field>
      </div>
      <RunBar
        label="Run risk of ruin"
        status={run.status}
        progress={run.progress}
        runtimeMs={run.runtimeMs}
        disabled={disabled}
        onRun={() =>
          start({
            kind: "ror",
            req: { sim, bankroll: b.bankroll, rounds: b.horizon, trials: b.trials, profitTarget: b.profitTarget, seed, samplePaths: 40 },
            ev: { rounds: 200_000, roundsPerHour },
          })
        }
        onCancel={cancel}
        detail={`${b.trials} sessions × up to ${b.horizon.toLocaleString()} rounds from ${money(b.bankroll)} (seed ${seed})`}
      />
      {res && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatTile label={`Broke within ${res.ror.rounds.toLocaleString()} rounds`} value={pct(res.ror.ruin.estimate, 1)} sub={`95% CI ${pct(res.ror.ruin.low, 1)} to ${pct(res.ror.ruin.high, 1)}`} />
            <StatTile label={`Reached +${money(res.ror.profitTarget)}`} value={pct(res.ror.target.estimate, 1)} sub={`95% CI ${pct(res.ror.target.low, 1)} to ${pct(res.ror.target.high, 1)}`} />
            <StatTile label="Median ending bankroll" value={money(res.ror.endingPercentiles.p50)} sub={`mean ${money(res.ror.meanEnding.estimate)}`} />
            <StatTile label="Max drawdown" value={money(res.ror.drawdownPercentiles.p50)} sub={`median; 95th pct ${money(res.ror.drawdownPercentiles.p95)}`} />
          </div>
          <table className="tabular w-full max-w-xl text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                {(["p5", "p25", "p50", "p75", "p95"] as const).map((k) => (
                  <th key={k} className="py-1 font-medium">
                    {k.slice(1)}th pct
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                {(["p5", "p25", "p50", "p75", "p95"] as const).map((k) => (
                  <td key={k} className="py-1">
                    {money(res.ror.endingPercentiles[k])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Bankroll trajectories ({res.ror.paths.length} sample sessions)</h3>
            <PathsChart paths={res.ror.paths} every={res.ror.pathEvery} start={res.ror.bankroll} format={money} />
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Session profit distribution ({res.ror.trials} sessions)</h3>
            <Histogram bins={res.ror.profitHistogram} format={money} caption="Each session ends at the horizon or when the bankroll can no longer cover the table minimum." />
          </div>
          <div className="space-y-1 rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
            <p>
              <strong className="text-foreground">Finite horizon (simulated):</strong> {pct(res.ror.ruin.estimate, 1)} of {res.ror.trials} independent
              sessions went broke within {res.ror.rounds.toLocaleString()} rounds. Sessions use full settlement (doubles, splits and insurance need
              covering chips) and are the independent units for the intervals.
            </p>
            <p>
              <strong className="text-foreground">Eventual risk of ruin (approximation, not simulated):</strong>{" "}
              {eventual === null ? "—" : res.ev.perRound.estimate > 0 ? pct(eventual, 1) : "100% (expectation not positive)"} from exp(−2·μ·B/σ²) with μ ={" "}
              {money(res.ev.perRound.estimate)} and σ = {money(res.ev.sdPer100 / 10)} per round, estimated from a separate {res.ev.roundsPlayed.toLocaleString()}
              -round run. It assumes playing forever with constant per-round mean and variance; μ itself is uncertain (95% CI {money(res.ev.perRound.low)} to{" "}
              {money(res.ev.perRound.high)}), which moves this figure a lot.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PenetrationPanel({ sim, rounds, seed, roundsPerHour, disabled }: { sim: SimConfig; rounds: number; seed: number; roundsPerHour: number; disabled: boolean }) {
  const { run, start, cancel } = useSimulation<PenetrationRow[]>();
  const rows = run.result;
  const decks = sim.rules.decks;
  return (
    <div className="space-y-4">
      <RunBar
        label="Compare penetration"
        status={run.status}
        progress={run.progress}
        runtimeMs={run.runtimeMs}
        disabled={disabled}
        onRun={() => start({ kind: "penetration", req: { sim, penetrations: PENETRATIONS, rounds, seed, roundsPerHour } })}
        onCancel={cancel}
        detail={`${PENETRATIONS.map((p) => `${Math.round(p * 100)}%`).join(", ")} · ${rounds.toLocaleString()} rounds each, same seed`}
      />
      {rows && (
        <div className="space-y-4">
          <div className="overflow-auto rounded-xl border border-border bg-card p-4">
            <table className="tabular w-full min-w-[720px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Cut card</th>
                  <th className="py-1 font-medium">Cards actually dealt</th>
                  <th className="py-1 font-medium">Rounds / shoe</th>
                  <th className="py-1 font-medium">Shuffles / 100 rounds</th>
                  <th className="py-1 font-medium">TC ≥ +1 / ≥ +2</th>
                  <th className="py-1 font-medium">Edge (initial)</th>
                  <th className="py-1 font-medium">Per 100 rounds</th>
                  <th className="py-1 font-medium">SD / 100</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = r.summary.penetration;
                  return (
                    <tr key={r.penetration} className="border-t border-border">
                      <td className="py-1.5">
                        {Math.round(r.penetration * 100)}% (card {p.cutCardIndex}, {decks * 52 - p.cutCardIndex} behind)
                      </td>
                      <td className="py-1.5">
                        {p.avgCardsDealtPerShoe?.toFixed(1)} ({pct(p.avgDealtFraction ?? 0, 1)})
                      </td>
                      <td className="py-1.5">{p.roundsPerShoe?.toFixed(2)}</td>
                      <td className="py-1.5">{p.reshufflesPer100Rounds.toFixed(1)}</td>
                      <td className="py-1.5">
                        {pct(r.favourable1, 1)} / {pct(r.favourable2, 1)}
                      </td>
                      <td className="py-1.5">{ciPct(r.summary.edgeOnInitial)}</td>
                      <td className="py-1.5">{ciMoney(r.summary.per100)}</td>
                      <td className="py-1.5">{money(r.summary.sdPer100)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Edge on initial wagers by penetration (95% CI)</h3>
            <IntervalChart rows={rows.map((r) => ({ label: `${Math.round(r.penetration * 100)}%`, ...r.summary.edgeOnInitial }))} format={(v) => pct(v)} />
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Share of betting opportunities at TC ≥ +2</h3>
            <GroupedBars
              categories={rows.map((r) => `${Math.round(r.penetration * 100)}%`)}
              series={[
                { label: "TC ≥ +1", values: rows.map((r) => r.favourable1) },
                { label: "TC ≥ +2", values: rows.map((r) => r.favourable2) },
              ]}
              format={(v) => pct(v, 1)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The cut card position is where the shuffle is triggered; the round in progress is always finished, so more cards are dealt than the cut
            position. All penetrations use the same seed, so they start from the same shuffles. Results are for the conventional rules shown, not
            Blackjack Elite.
          </p>
        </div>
      )}
    </div>
  );
}
