"use client";

import Link from "next/link";
import { ProgressChart } from "@/components/dashboard/progress-chart";
import { StatTile, formatMs, pct } from "@/components/training/controls";
import { useStats } from "@/hooks/use-store";
import { parseScenarioKey } from "@/lib/training/basic-strategy";
import { ACTION_LABEL } from "@/lib/training/explain";
import { accuracy, missedScenarios, type Tally } from "@/lib/training/stats";

const sum = (...ts: Tally[]): Tally => ts.reduce((a, t) => ({ attempts: a.attempts + t.attempts, correct: a.correct + t.correct }), { attempts: 0, correct: 0 });

export function Dashboard() {
  const [stats] = useStats();
  const { bs, rc, tc } = stats;
  const rcAll = sum(rc.drills, rc.flashcards);
  const tcAll = sum(tc.calculate, tc.estimateOverall);
  const missed = missedScenarios(stats).slice(0, 10);
  const sessions = stats.sessions.bs + stats.sessions.rc + stats.sessions.tc;
  const avgMs = bs.overall.attempts ? bs.totalMs / bs.overall.attempts : null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionTitle title="Decision accuracy" note="Basic-strategy choices graded against the strategy for the rules in force when you answered." />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Decisions" value={bs.overall.attempts} />
          <StatTile label="Overall" value={pct(accuracy(bs.overall), 1)} />
          <StatTile label="Hard totals" value={pct(accuracy(bs.byCategory.hard))} sub={`${bs.byCategory.hard.attempts} hands`} />
          <StatTile label="Soft totals" value={pct(accuracy(bs.byCategory.soft))} sub={`${bs.byCategory.soft.attempts} hands`} />
          <StatTile label="Pairs" value={pct(accuracy(bs.byCategory.pair))} sub={`${bs.byCategory.pair.attempts} hands`} />
          <StatTile label="Avg response" value={avgMs === null ? "—" : formatMs(avgMs)} />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle title="Counting accuracy" note="Only submitted answers count. Skipped drills are never treated as correct." />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Running count" value={pct(accuracy(rcAll))} sub={`${rcAll.attempts} answers`} />
          <StatTile label="RC drills" value={pct(accuracy(rc.drills))} sub={`${rc.drills.attempts} drills`} />
          <StatTile label="Best deck" value={rc.bestDeckMs ? formatMs(rc.bestDeckMs) : "—"} sub="correct countdowns only" />
          <StatTile label="True count" value={pct(accuracy(tcAll))} sub={`${tcAll.attempts} answers`} />
          <StatTile label="Deck estimation" value={pct(accuracy(tc.deckEstimate))} sub={`${tc.deckEstimate.attempts} estimates`} />
          <StatTile label="Sessions" value={sessions} sub={`BS ${stats.sessions.bs} · RC ${stats.sessions.rc} · TC ${stats.sessions.tc}`} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Daily accuracy, last 30 active days</h2>
          <ProgressChart history={stats.history} />
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Frequently missed decisions</h2>
            {missed.length > 0 && (
              <Link href="/basic-strategy" className="text-xs text-primary hover:underline">
                Drill missed →
              </Link>
            )}
          </div>
          {missed.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <table className="tabular w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-1 font-medium">Hand</th>
                  <th className="pb-1 font-medium">Missed</th>
                  <th className="pb-1 font-medium">You chose</th>
                  <th className="pb-1 font-medium">Correct</th>
                </tr>
              </thead>
              <tbody>
                {missed.map(({ key, rec }) => {
                  const { row, up } = parseScenarioKey(key);
                  return (
                    <tr key={key} className="border-t border-border">
                      <td className="py-1.5 capitalize">
                        {row} <span className="text-muted-foreground normal-case">v {up}</span>
                      </td>
                      <td className="py-1.5">
                        {rec.misses}/{rec.attempts}
                      </td>
                      <td className="py-1.5 text-destructive">{rec.lastChosen ? ACTION_LABEL[rec.lastChosen] : "—"}</td>
                      <td className="py-1.5 text-success">{rec.lastBest ? ACTION_LABEL[rec.lastBest] : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-1 font-semibold">Theoretical cost of errors</h2>
          <p className="tabular text-2xl font-semibold">{bs.overall.attempts ? `${((bs.evLost / bs.overall.attempts) * 100).toFixed(2)}%` : "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Average expected value given up per decision, relative to basic strategy (computed, not observed). This is a long-run expectation. It is
            not a measure of money won or lost.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <h2 className="mb-1 font-semibold">Simulated bankroll</h2>
          <p className="text-xs text-muted-foreground">
            Bankroll results will come from the table simulator, which isn&apos;t built yet. When they appear they will be kept separate from
            decision accuracy and expected value: a short winning session is mostly variance and does not show a positive edge.
          </p>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
