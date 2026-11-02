"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Info, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayingCard } from "@/components/blackjack/playing-card";
import { Field, Kbd, Segmented, StatTile, pct } from "@/components/training/controls";
import { StrategyChart } from "@/components/training/strategy-chart";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useSettings, useStats } from "@/hooks/use-store";
import { pointRank, pointRankLabel } from "@/lib/blackjack/cards";
import { describeHand } from "@/lib/blackjack/hand";
import { defaultRng } from "@/lib/blackjack/rng";
import { describeRules } from "@/lib/blackjack/rules";
import { strategyTableFor, type PlayerAction } from "@/lib/blackjack/strategy";
import { generateScenario, gradeChoice, parseScenarioKey, type BSMode, type BSResult, type BSScenario, type UpcardFilter } from "@/lib/training/basic-strategy";
import { ACTION_LABEL, explainAdvice, formatEv } from "@/lib/training/explain";
import { accuracy, missedScenarios, recordBasicStrategy, recordSession, type Tally } from "@/lib/training/stats";
import { cn } from "@/lib/utils";

const ACTION_KEYS: Record<PlayerAction, string> = { hit: "H", stand: "S", double: "D", split: "P", surrender: "R" };
const ACTION_ORDER: PlayerAction[] = ["hit", "stand", "double", "split", "surrender"];

const MODE_OPTIONS: { value: BSMode; label: string }[] = [
  { value: "all", label: "All hands" },
  { value: "hard", label: "Hard" },
  { value: "soft", label: "Soft" },
  { value: "pairs", label: "Pairs" },
  { value: "missed", label: "Missed" },
];

const UP_OPTIONS: { value: UpcardFilter; label: string }[] = [
  { value: "any", label: "Any upcard" },
  { value: "weak", label: "Dealer 2–6" },
  { value: "strong", label: "Dealer 7–A" },
];

export function BasicStrategyTrainer() {
  const [settings, setSettings] = useSettings();
  const [stats, setStats] = useStats();
  const { rules, bs: opts } = settings;
  const table = useMemo(() => strategyTableFor(rules), [rules]);
  const rng = useMemo(() => defaultRng(), []);

  const [scenario, setScenario] = useState<BSScenario | null>(null);
  const [result, setResult] = useState<BSResult | null>(null);
  const [session, setSession] = useState<Tally & { streak: number }>({ attempts: 0, correct: 0, streak: 0 });
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [showChart, setShowChart] = useState(false);
  const shownAt = useRef(0);
  const sessionCounted = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const missed = useMemo(() => missedScenarios(stats).map((m) => m.key), [stats]);
  const missedRef = useRef(missed);
  missedRef.current = missed;

  const next = useCallback(() => {
    clearTimeout(advanceTimer.current);
    setResult(null);
    setScenario(generateScenario(rules, opts, rng, missedRef.current));
    shownAt.current = performance.now();
  }, [rules, opts, rng]);

  // New hand whenever rules or options change (and on first mount, client-side only).
  useEffect(() => {
    next();
  }, [next]);

  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const choose = useCallback(
    (action: PlayerAction) => {
      if (!scenario || result || !scenario.available.includes(action)) return;
      const ms = performance.now() - shownAt.current;
      const g = gradeChoice(scenario, action);
      setResult(g);
      setSession((s) => ({ attempts: s.attempts + 1, correct: s.correct + (g.correct ? 1 : 0), streak: g.correct ? s.streak + 1 : 0 }));
      setStats((s) => {
        let out = recordBasicStrategy(s, {
          at: Date.now(),
          key: scenario.key,
          category: scenario.advice.category,
          chosen: action,
          best: scenario.advice.best,
          correct: g.correct,
          ms,
          evLoss: g.evLoss,
        });
        if (!sessionCounted.current) {
          sessionCounted.current = true;
          out = recordSession(out, "bs");
        }
        return out;
      });
      if (g.correct && autoAdvance) advanceTimer.current = setTimeout(next, 650);
    },
    [scenario, result, setStats, autoAdvance, next],
  );

  useHotkeys({
    h: () => choose("hit"),
    s: () => choose("stand"),
    d: () => choose("double"),
    p: () => choose("split"),
    r: () => choose("surrender"),
    " ": () => result && next(),
    enter: () => result && next(),
  });

  const setOpts = (patch: Partial<typeof opts>) => setSettings((s) => ({ ...s, bs: { ...s.bs, ...patch } }));
  const overall = stats.bs.overall;
  const up = scenario ? pointRank(scenario.dealerUp.rank) : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented ariaLabel="Hand type" value={opts.mode} onChange={(mode) => setOpts({ mode })} options={MODE_OPTIONS.map((o) => (o.value === "missed" ? { ...o, label: `Missed (${missed.length})` } : o))} />
          <Segmented ariaLabel="Dealer upcard" value={opts.upcards} onChange={(upcards) => setOpts({ upcards })} options={UP_OPTIONS} />
        </div>
        {opts.mode === "missed" && missed.length === 0 && (
          <p className="text-xs text-muted-foreground">No missed scenarios yet. Dealing from all hands until you miss one.</p>
        )}

        <div className="felt relative flex min-h-[400px] flex-col items-center justify-between gap-5 rounded-2xl px-4 py-6 sm:min-h-[440px]">
          <div className="flex flex-col items-center gap-2">
            <span className="text-[11px] font-medium tracking-[0.2em] text-amber-100/60 uppercase">Dealer</span>
            <div className="flex">
              {scenario && <PlayingCard card={scenario.dealerUp} size="lg" />}
              {scenario && <PlayingCard faceDown size="lg" className="-ml-4 sm:-ml-6" />}
            </div>
          </div>

          <div className="pointer-events-none text-center text-[11px] tracking-[0.2em] text-amber-100/30 uppercase">
            {rules.blackjackPayout === "3:2" ? "Blackjack pays 3 to 2" : "Blackjack pays 6 to 5"} · Dealer {rules.dealerHitsSoft17 ? "hits" : "stands on"} soft 17
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="flex">
              {scenario?.player.map((c, i) => <PlayingCard key={c.id} card={c} size="lg" className={i > 0 ? "-ml-10" : ""} />)}
            </div>
            <span className="rounded-full bg-black/30 px-3 py-0.5 text-sm font-medium text-amber-50">
              {scenario ? describeHand(scenario.player) : "Dealing…"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {ACTION_ORDER.map((a) => {
            const available = scenario?.available.includes(a);
            const isBest = result && scenario?.advice.acceptable.includes(a);
            const isChosen = result?.chosen === a;
            return (
              <Button
                key={a}
                size="lg"
                variant="secondary"
                disabled={!available || !!result}
                onClick={() => choose(a)}
                className={cn(
                  "h-11 min-w-24 gap-2 text-sm disabled:opacity-35",
                  result && isBest && "bg-success/20 text-success ring-1 ring-success/60 disabled:opacity-100",
                  result && isChosen && !isBest && "bg-destructive/20 text-destructive ring-1 ring-destructive/60 disabled:opacity-100",
                )}
              >
                {ACTION_LABEL[a]}
                <Kbd>{ACTION_KEYS[a]}</Kbd>
              </Button>
            );
          })}
        </div>

        <div aria-live="polite" className="min-h-[132px]">
          {result && scenario && up !== null && (
            <FeedbackPanel scenario={scenario} result={result} explanation={explainAdvice(scenario.advice, up, table)} onNext={next} />
          )}
          {!result && (
            <p className="hidden pt-2 text-center text-xs text-muted-foreground sm:block">
              Keys: <Kbd>H</Kbd> hit · <Kbd>S</Kbd> stand · <Kbd>D</Kbd> double · <Kbd>P</Kbd> split
              {rules.surrender === "late" && (
                <>
                  {" "}· <Kbd>R</Kbd> surrender
                </>
              )}{" "}
              · <Kbd>Space</Kbd> next
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card">
          <button
            type="button"
            onClick={() => setShowChart((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
          >
            Strategy chart for these rules
            <ChevronDown className={cn("size-4 transition-transform", showChart && "rotate-180")} />
          </button>
          {showChart && (
            <div className="border-t border-border px-4 py-4">
              <StrategyChart
                rules={rules}
                highlight={result && scenario ? { row: scenario.advice.row, up: parseScenarioKey(scenario.key).up } : undefined}
              />
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Session" value={pct(accuracy(session))} sub={`${session.correct}/${session.attempts} correct`} />
          <StatTile label="Streak" value={session.streak} sub={`Best ever ${stats.bs.bestStreak}`} />
          <StatTile label="All-time" value={pct(accuracy(overall), 1)} sub={`${overall.attempts} hands`} />
          <StatTile
            label="Avg time"
            value={overall.attempts ? `${(stats.bs.totalMs / overall.attempts / 1000).toFixed(1)}s` : "—"}
            sub="per decision"
          />
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <Field label="Options">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--primary)]" checked={opts.skipTrivial} onChange={(e) => setOpts({ skipTrivial: e.target.checked })} />
              Skip trivial hands (hard ≤7, hard 18+, soft 20)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--primary)]" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} />
              Auto-advance after a correct answer
            </label>
          </Field>
          <Field label="Rules">
            <p className="text-sm">{describeRules(rules)}</p>
            <Link href="/settings" className="text-xs text-primary hover:underline">
              Change table rules →
            </Link>
          </Field>
        </div>

        <div className="flex gap-2 rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <p>
            Graded against total-dependent basic strategy computed by exact combinatorial analysis for these rules (no count-based deviations). The
            generator was checked against the published 6-deck charts cell by cell. Splits are evaluated without resplitting.
          </p>
        </div>
      </aside>
    </div>
  );
}

function FeedbackPanel({ scenario, result, explanation, onNext }: { scenario: BSScenario; result: BSResult; explanation: string; onNext: () => void }) {
  const { advice } = scenario;
  const evs = ACTION_ORDER.filter((a) => advice.evs[a] !== undefined).map((a) => [a, advice.evs[a]!] as const);
  const upLabel = pointRankLabel(pointRank(scenario.dealerUp.rank));
  const ties = advice.acceptable.length > 1;
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        result.correct ? "border-success/40 bg-success/[0.07]" : "border-destructive/40 bg-destructive/[0.07]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {result.correct ? <CheckCircle2 className="mt-0.5 size-5 text-success" /> : <XCircle className="mt-0.5 size-5 text-destructive" />}
          <div>
            <div className="font-semibold">
              {result.correct ? "Correct" : "Incorrect"} — {ties ? advice.acceptable.map((a) => ACTION_LABEL[a]).join(" or ") : ACTION_LABEL[advice.best]}{" "}
              <span className="font-normal text-muted-foreground">
                with {describeHand(scenario.player).toLowerCase()} vs {upLabel}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-foreground/85">{explanation}</p>
            {ties && <p className="mt-1 text-xs text-muted-foreground">These plays have equal expected value; either is accepted.</p>}
            {result.closeCall && !ties && (
              <p className="mt-1 text-xs text-amber-200/80">Close call: the runner-up play is within 0.25% of a bet.</p>
            )}
            {!result.correct && (
              <p className="mt-1 text-xs text-muted-foreground">
                Your {ACTION_LABEL[result.chosen].toLowerCase()} gives up {(result.evLoss * 100).toFixed(1)}% of the bet on average.
              </p>
            )}
          </div>
        </div>
        <Button onClick={onNext} size="lg" className="gap-2">
          Next hand <Kbd>Space</Kbd>
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 pl-7">
        {evs.map(([a, ev]) => (
          <span
            key={a}
            className={cn(
              "tabular rounded-md border px-2 py-0.5 text-xs",
              advice.acceptable.includes(a) ? "border-success/50 text-success" : "border-border text-muted-foreground",
            )}
          >
            {ACTION_LABEL[a]} {formatEv(ev)}
          </span>
        ))}
        <span className="self-center text-[11px] text-muted-foreground">EV per unit bet</span>
      </div>
    </div>
  );
}
