"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayingCard } from "@/components/blackjack/playing-card";
import { DiscardTray } from "@/components/training/discard-tray";
import { Field, Kbd, Segmented, StatTile, pct } from "@/components/training/controls";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useSettings, useStats } from "@/hooks/use-store";
import { formatCount, ROUNDING_LABELS } from "@/lib/blackjack/counting";
import { DEVIATION_CELLS, type DeviationAction } from "@/lib/blackjack/deviations/definitions";
import { actionWord, cellUnavailableReason, cellValidation, formatTc, indexDescription, indexMethod, resolveIndexSet } from "@/lib/blackjack/deviations/registry";
import { VALIDATION } from "@/lib/blackjack/deviations/validation";
import { defaultRng } from "@/lib/blackjack/rng";
import { describeRules } from "@/lib/blackjack/rules";
import { filterCells, generateDeviationScenario, gradeDeviationAnswer, type DeviationFilter, type DeviationScenario } from "@/lib/training/deviation-trainer";
import { accuracy, missedDeviationCells, recordDeviation, recordSession, type Tally } from "@/lib/training/stats";
import { cn } from "@/lib/utils";

const ACTIONS: { action: DeviationAction; label: string; key: string }[] = [
  { action: "hit", label: "Hit", key: "H" },
  { action: "stand", label: "Stand", key: "S" },
  { action: "double", label: "Double", key: "D" },
  { action: "split", label: "Split", key: "P" },
  { action: "surrender", label: "Surrender", key: "R" },
  { action: "insure", label: "Take insurance", key: "I" },
  { action: "decline", label: "No insurance", key: "N" },
];

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "valuable", label: "Most valuable" },
  { value: "positive", label: "Positive count" },
  { value: "negative", label: "Negative count" },
  { value: "missed", label: "Missed" },
];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function DeviationTrainer() {
  const [settings, setSettings] = useSettings();
  const [stats, setStats] = useStats();
  const { rules, rounding, dev } = settings;
  const rng = useMemo(() => defaultRng(), []);
  const resolution = useMemo(() => resolveIndexSet(rules, rounding), [rules, rounding]);
  const [scenario, setScenario] = useState<DeviationScenario | null>(null);
  const [answer, setAnswer] = useState<{ chosen: DeviationAction; correct: boolean } | null>(null);
  const [session, setSession] = useState<Tally>({ attempts: 0, correct: 0 });
  const sessionCounted = useRef(false);

  const missed = useMemo(() => missedDeviationCells(stats), [stats]);
  const missedRef = useRef(missed);
  missedRef.current = missed;
  const filter: DeviationFilter = FILTERS.some((f) => f.value === dev.filter) ? (dev.filter as DeviationFilter) : { cellId: dev.filter };

  const next = useCallback(() => {
    setAnswer(null);
    if (!resolution.supported) return setScenario(null);
    let cells = filterCells(resolution.set, rules, filter, rounding, missedRef.current);
    if (!cells.length) cells = filterCells(resolution.set, rules, "all", rounding);
    setScenario(generateDeviationScenario(resolution.set, rules, rounding, cells, rng));
    // filter is derived from dev.filter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution, rules, rounding, dev.filter, rng]);

  useEffect(() => {
    next();
  }, [next]);

  const choose = (a: DeviationAction) => {
    if (!scenario || answer || !scenario.legal.includes(a)) return;
    const g = gradeDeviationAnswer(scenario, a);
    setAnswer({ chosen: a, correct: g.correct });
    setSession((s) => ({ attempts: s.attempts + 1, correct: s.correct + (g.correct ? 1 : 0) }));
    setStats((s) => {
      const out = recordDeviation(s, { at: Date.now(), cellId: scenario.cell.id, correct: g.correct, chosen: a });
      if (sessionCounted.current) return out;
      sessionCounted.current = true;
      return recordSession(out, "dev");
    });
  };

  useHotkeys({
    h: () => choose("hit"),
    s: () => choose("stand"),
    d: () => choose("double"),
    p: () => choose("split"),
    r: () => choose("surrender"),
    i: () => choose("insure"),
    n: () => choose("decline"),
    " ": () => answer && next(),
    enter: () => answer && next(),
  });

  const setDev = (patch: Partial<typeof dev>) => setSettings((s) => ({ ...s, dev: { ...s.dev, ...patch } }));

  if (!resolution.supported) {
    return (
      <div className="flex max-w-2xl items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-300" />
        <div className="space-y-2">
          <p className="font-medium">No validated deviation indices for these rules.</p>
          <p className="text-muted-foreground">{resolution.reason}</p>
          <p className="text-muted-foreground">Current rules: {describeRules(rules)}.</p>
          <Link href="/settings" className="text-primary hover:underline">
            Change table rules →
          </Link>
        </div>
      </div>
    );
  }

  const set = resolution.set;
  const usable = DEVIATION_CELLS.filter((c) => !cellUnavailableReason(set, c, rules, rounding));
  const e = scenario?.evaluation;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            ariaLabel="Practice filter"
            value={FILTERS.some((f) => f.value === dev.filter) ? dev.filter : ""}
            onChange={(v) => setDev({ filter: v })}
            options={FILTERS.map((f) => (f.value === "missed" ? { ...f, label: `Missed (${missed.length})` } : f))}
          />
          <select
            aria-label="Practice one index"
            value={FILTERS.some((f) => f.value === dev.filter) ? "" : dev.filter}
            onChange={(ev) => setDev({ filter: ev.target.value || "all" })}
            className="h-8 rounded-lg border border-input bg-input/30 px-2 text-sm"
          >
            <option value="">One index…</option>
            {usable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="felt grid min-h-[380px] items-center gap-6 rounded-2xl px-5 py-6 sm:grid-cols-[1fr_auto]">
          {scenario ? (
            <>
              <div className="flex flex-col items-center gap-6">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[11px] tracking-[0.2em] text-amber-100/60 uppercase">Dealer</span>
                  <div className="flex">
                    <PlayingCard card={scenario.dealerUp} size="lg" />
                    <PlayingCard faceDown size="lg" className="-ml-6" />
                  </div>
                </div>
                <div className="flex">
                  {scenario.player.map((c, i) => (
                    <PlayingCard key={c.id} card={c} size="lg" className={i ? "-ml-10" : ""} />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-1 sm:text-left">
                <Readout label="Running count" value={formatCount(scenario.runningCount)} />
                <Readout label="Decks remaining" value={`${scenario.decksRemaining}`} />
                <Readout label="True count" value={dev.showTrueCount || answer ? formatTc(scenario.trueCount) : "?"} />
                {dev.showTray && (
                  <div className="col-span-3 sm:col-span-1">
                    <DiscardTray decks={rules.decks} cardsDealt={scenario.discards.length + 3} seed={scenario.runningCount + scenario.discards.length} guides={false} className="h-auto w-24" />
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-center text-sm text-amber-50/80 sm:col-span-2">No scenario available for this filter.</p>
          )}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {ACTIONS.filter((a) => scenario?.legal.includes(a.action)).map(({ action, label, key }) => {
            const ok = answer && e?.acceptable.includes(action);
            const bad = answer && answer.chosen === action && !ok;
            return (
              <Button
                key={action}
                size="lg"
                variant="secondary"
                disabled={!!answer}
                onClick={() => choose(action)}
                className={cn(
                  "h-11 min-w-24 gap-2",
                  ok && "bg-success/20 text-success ring-1 ring-success/60 disabled:opacity-100",
                  bad && "bg-destructive/20 text-destructive ring-1 ring-destructive/60 disabled:opacity-100",
                )}
              >
                {label} <Kbd>{key}</Kbd>
              </Button>
            );
          })}
        </div>

        <div aria-live="polite" className="min-h-[120px]">
          {answer && scenario && e && (
            <div className={cn("rounded-xl border p-4 text-sm", answer.correct ? "border-success/40 bg-success/[0.07]" : "border-destructive/40 bg-destructive/[0.07]")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  {answer.correct ? <CheckCircle2 className="mt-0.5 size-5 text-success" /> : <XCircle className="mt-0.5 size-5 text-destructive" />}
                  <div className="space-y-1">
                    <div className="font-semibold">
                      {answer.correct ? "Correct" : "Incorrect"}: {cap(actionWord(e.countAction))} at TC {formatTc(e.trueCount)}
                    </div>
                    <p>
                      <span className="text-muted-foreground">Index ({scenario.cell.label}):</span> {e.indexText}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Basic strategy:</span> {actionWord(e.basic)}.{" "}
                      {e.deviates
                        ? `The true count of ${formatTc(e.trueCount)} has crossed the index, so the count-adjusted play differs from basic strategy.`
                        : `The true count of ${formatTc(e.trueCount)} has not crossed the index, so basic strategy stands.`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatCount(scenario.runningCount)} ÷ {scenario.decksRemaining} decks → {formatTc(e.trueCount)} ({ROUNDING_LABELS[rounding].toLowerCase()}).
                    </p>
                  </div>
                </div>
                <Button onClick={next} size="lg" className="gap-2">
                  Next <Kbd>Space</Kbd>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Session" value={pct(accuracy(session))} sub={`${session.correct}/${session.attempts}`} />
          <StatTile label="All-time" value={pct(accuracy(stats.dev.overall))} sub={`${stats.dev.overall.attempts} answers`} />
        </div>
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <Field label="Display">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--primary)]" checked={dev.showTrueCount} onChange={(ev) => setDev({ showTrueCount: ev.target.checked })} />
              Show the true count (otherwise convert it yourself)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--primary)]" checked={dev.showTray} onChange={(ev) => setDev({ showTray: ev.target.checked })} />
              Show the discard tray
            </label>
          </Field>
          <p className="text-xs text-muted-foreground">
            {describeRules(rules)} · {ROUNDING_LABELS[rounding]} · <Link href="/settings" className="text-primary hover:underline">change</Link>
          </p>
        </div>
        <IndexTable resolutionId={resolution.id} />
      </aside>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.18em] text-amber-50/60 uppercase">{label}</div>
      <div className="tabular text-2xl font-semibold text-amber-50">{value}</div>
    </div>
  );
}

/** Every index cell for the active rules, with its play or the reason it is disabled. */
export function IndexTable({ resolutionId }: { resolutionId: string }) {
  const [settings] = useSettings();
  const [stats] = useStats();
  const { rules, rounding } = settings;
  const r = resolveIndexSet(rules, rounding);
  if (!r.supported) return null;
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4">
      <div className="text-sm font-semibold">Index set</div>
      <p className="text-[11px] text-muted-foreground">{resolutionId}</p>
      <ul className="divide-y divide-border text-xs">
        {DEVIATION_CELLS.map((c) => {
          const reason = cellUnavailableReason(r.set, c, rules, rounding);
          const status = cellValidation(r.set, c.id, rounding).status;
          const t = stats.dev.byCell[c.id];
          return (
            <li key={c.id} className="flex items-start justify-between gap-2 py-1.5">
              <span className="w-16 shrink-0 font-medium">{c.label}</span>
              <span className={cn("flex-1", reason && "text-muted-foreground/70")}>
                <span
                  className={cn(
                    "mr-1 rounded px-1 text-[10px] font-semibold uppercase",
                    reason ? "bg-muted text-muted-foreground" : "bg-success/20 text-success",
                  )}
                >
                  {reason ? (status === "validated" ? "n/a" : status) : "validated"}
                </span>
                {reason ? reason : indexDescription(r.set, c.id, rounding)}
                {reason && status === "experimental" && <span className="block">{indexDescription(r.set, c.id, rounding)}</span>}
              </span>
              <span className="tabular shrink-0 text-muted-foreground">{t ? pct(accuracy(t)) : ""}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Only validated indices are practised and graded. Validation: {VALIDATION.method || "not yet run."} Synthetic estimates: {indexMethod()}
      </p>
    </div>
  );
}
