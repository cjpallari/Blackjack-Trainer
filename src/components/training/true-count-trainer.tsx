"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DiscardTray } from "@/components/training/discard-tray";
import { Field, Kbd, Segmented, StatTile, pct } from "@/components/training/controls";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useSettings, useStats } from "@/hooks/use-store";
import { formatCount, rawTrueCount, ROUNDING_LABELS, type TrueCountRounding } from "@/lib/blackjack/counting";
import { defaultRng } from "@/lib/blackjack/rng";
import { accuracy, recordSession, recordTc } from "@/lib/training/stats";
import { deckTolerance, generateTCScenario, gradeCalculate, gradeEstimate, TC_DECK_OPTIONS, type TCGrade, type TCMode, type TCScenario } from "@/lib/training/true-count";
import { cn } from "@/lib/utils";

function parseNumber(s: string): number | null {
  const t = s.trim().replace("−", "-").replace("+", "").replace(",", ".");
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function fmtDecks(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

export function TrueCountTrainer() {
  const [settings, setSettings] = useSettings();
  const [stats, setStats] = useStats();
  const { tc: cfg, rounding } = settings;
  const setCfg = (patch: Partial<typeof cfg>) => setSettings((s) => ({ ...s, tc: { ...s.tc, ...patch } }));
  const rng = useMemo(() => defaultRng(), []);

  const [mode, setMode] = useState<TCMode>("calculate");
  const [scenario, setScenario] = useState<TCScenario | null>(null);
  const [seed, setSeed] = useState(1);
  const [deckAnswer, setDeckAnswer] = useState("");
  const [tcAnswer, setTcAnswer] = useState("");
  const [grade, setGrade] = useState<(TCGrade & { timedOut: boolean; deckEstimate?: number; answer?: number }) | null>(null);
  const [remaining, setRemaining] = useState(cfg.secondsPerQuestion);
  const shownAt = useRef(0);
  const sessionCounted = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);

  const next = useCallback(() => {
    setScenario(generateTCScenario(cfg.decks, rng));
    setSeed(Math.floor(rng() * 1e9));
    setDeckAnswer("");
    setTcAnswer("");
    setGrade(null);
    setRemaining(cfg.secondsPerQuestion);
    shownAt.current = performance.now();
    setTimeout(() => firstInput.current?.focus(), 0);
  }, [cfg.decks, cfg.secondsPerQuestion, rng]);

  useEffect(() => {
    next();
  }, [next, mode]);

  const record = useCallback(
    (g: TCGrade, timedOut: boolean) => {
      const ms = performance.now() - shownAt.current;
      setStats((s) => {
        let out = recordTc(s, {
          at: Date.now(),
          mode,
          tcCorrect: g.tcCorrect && !timedOut,
          deckCorrect: g.deckCorrect,
          calculationCorrect: g.calculationCorrect,
          ms,
          timedOut,
        });
        if (!sessionCounted.current) {
          sessionCounted.current = true;
          out = recordSession(out, "tc");
        }
        return out;
      });
    },
    [mode, setStats],
  );

  const submit = useCallback(
    (timedOut = false) => {
      if (!scenario || grade) return;
      const tc = parseNumber(tcAnswer);
      if (mode === "calculate") {
        if (tc === null && !timedOut) return;
        const g = gradeCalculate(scenario, tc ?? NaN, rounding);
        setGrade({ ...g, tcCorrect: g.tcCorrect && !timedOut, timedOut, answer: tc ?? undefined });
        record(g, timedOut);
      } else {
        const d = parseNumber(deckAnswer);
        if ((tc === null || d === null || d <= 0) && !timedOut) return;
        const g = gradeEstimate(scenario, d ?? NaN, tc ?? NaN, rounding);
        const graded = timedOut ? { ...g, tcCorrect: false, deckCorrect: d !== null && g.deckCorrect, calculationCorrect: false } : g;
        setGrade({ ...graded, timedOut, deckEstimate: d ?? undefined, answer: tc ?? undefined });
        record(graded, timedOut);
      }
    },
    [scenario, grade, tcAnswer, deckAnswer, mode, rounding, record],
  );

  // Per-question countdown in timed mode (deadline-based so typing doesn't reset it).
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!cfg.timed || grade || !scenario) return;
    const deadline = shownAt.current + cfg.secondsPerQuestion * 1000;
    const id = setInterval(() => {
      const left = Math.ceil((deadline - performance.now()) / 1000);
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        submitRef.current(true);
      }
    }, 200);
    return () => clearInterval(id);
  }, [cfg.timed, cfg.secondsPerQuestion, grade, scenario]);

  useHotkeys({ enter: () => (grade ? next() : submit()), " ": () => grade && next() }, { allowInInputs: ["enter"] });

  const s = scenario;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            size="md"
            ariaLabel="Mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "calculate", label: "A · Calculate" },
              { value: "estimate", label: "B · Estimate from tray" },
            ]}
          />
          <Segmented ariaLabel="Decks" value={cfg.decks} onChange={(decks) => setCfg({ decks })} options={TC_DECK_OPTIONS.map((d) => ({ value: d, label: `${d}D` }))} />
        </div>

        <div className={cn("felt relative grid min-h-[340px] items-center gap-6 rounded-2xl px-6 py-6", mode === "estimate" ? "sm:grid-cols-[1fr_auto]" : "justify-items-center")}>
          {cfg.timed && !grade && (
            <div className={cn("tabular absolute top-3 right-4 text-sm font-medium", remaining <= 3 ? "text-destructive" : "text-amber-50/70")}>{remaining}s</div>
          )}
          {s && (
            <>
              <div className="space-y-5">
                <Readout label="Running count" value={formatCount(s.runningCount)} />
                {mode === "calculate" ? (
                  <Readout label="Decks remaining" value={fmtDecks(s.decksRemainingQuarter)} />
                ) : (
                  <p className="max-w-xs text-sm text-amber-50/70">
                    {cfg.decks}-deck shoe. Judge the discard tray, estimate the decks still to be dealt, then convert.
                  </p>
                )}
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  {mode === "estimate" && (
                    <label className="space-y-1">
                      <span className="block text-xs text-amber-50/70">Decks remaining</span>
                      <Input
                        ref={firstInput}
                        inputMode="decimal"
                        autoComplete="off"
                        value={deckAnswer}
                        disabled={!!grade}
                        onChange={(e) => setDeckAnswer(e.target.value)}
                        className="tabular h-11 w-28 bg-black/30 text-center text-lg"
                        placeholder="e.g. 2.5"
                      />
                    </label>
                  )}
                  <label className="space-y-1">
                    <span className="block text-xs text-amber-50/70">True count</span>
                    <Input
                      ref={mode === "calculate" ? firstInput : undefined}
                      inputMode="decimal"
                      autoComplete="off"
                      value={tcAnswer}
                      disabled={!!grade}
                      onChange={(e) => setTcAnswer(e.target.value)}
                      className="tabular h-11 w-28 bg-black/30 text-center text-lg"
                      placeholder={rounding === "exact" ? "e.g. 2.5" : "e.g. +3"}
                    />
                  </label>
                  {!grade && (
                    <Button type="submit" size="lg">
                      Check <Kbd>Enter</Kbd>
                    </Button>
                  )}
                </form>
              </div>
              {mode === "estimate" && (
                <div className="flex flex-col items-center gap-1 justify-self-center">
                  <DiscardTray decks={cfg.decks} cardsDealt={s.cardsDealt} seed={seed} guides={cfg.showTrayGuides} />
                  <span className="text-[10px] tracking-[0.2em] text-amber-50/50 uppercase">Discard tray</span>
                </div>
              )}
            </>
          )}
        </div>

        <div aria-live="polite" className="min-h-[120px]">
          {grade && s && <TCFeedback scenario={s} grade={grade} mode={mode} rounding={rounding} onNext={next} />}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Calculation" value={pct(accuracy(stats.tc.calculate))} sub={`${stats.tc.calculate.attempts} questions (A)`} />
          <StatTile label="Tray → TC" value={pct(accuracy(stats.tc.estimateOverall))} sub={`${stats.tc.estimateOverall.attempts} questions (B)`} />
          <StatTile label="Deck estimates" value={pct(accuracy(stats.tc.deckEstimate))} sub={`within ±${deckTolerance(cfg.decks)} deck`} />
          <StatTile label="B arithmetic" value={pct(accuracy(stats.tc.estimateCalculation))} sub="using your estimate" />
        </div>
        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          <Field label="Rounding">
            <select
              value={rounding}
              onChange={(e) => setSettings((st) => ({ ...st, rounding: e.target.value as TrueCountRounding }))}
              className="h-8 w-full rounded-lg border border-input bg-input/30 px-2 text-sm"
            >
              {(Object.keys(ROUNDING_LABELS) as TrueCountRounding[]).map((r) => (
                <option key={r} value={r}>
                  {ROUNDING_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Timing">
            <Segmented
              value={cfg.timed ? cfg.secondsPerQuestion : 0}
              onChange={(v) => setCfg(v === 0 ? { timed: false } : { timed: true, secondsPerQuestion: v })}
              options={[
                { value: 0, label: "Untimed" },
                { value: 5, label: "5s" },
                { value: 8, label: "8s" },
                { value: 12, label: "12s" },
              ]}
            />
          </Field>
          {mode === "estimate" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--primary)]" checked={cfg.showTrayGuides} onChange={(e) => setCfg({ showTrayGuides: e.target.checked })} />
              Show deck guide marks on the tray
            </label>
          )}
        </div>
        <p className="rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
          Scenarios are real shoe states: a shoe is shuffled, a random number of cards dealt (10–85% penetration) and counted. Decks remaining are given
          to the nearest quarter deck.
        </p>
      </aside>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs tracking-[0.18em] text-amber-50/60 uppercase">{label}</div>
      <div className="tabular text-4xl font-semibold text-amber-50">{value}</div>
    </div>
  );
}

function TCFeedback({
  scenario: s,
  grade: g,
  mode,
  rounding,
  onNext,
}: {
  scenario: TCScenario;
  grade: TCGrade & { timedOut: boolean; deckEstimate?: number; answer?: number };
  mode: TCMode;
  rounding: TrueCountRounding;
  onNext: () => void;
}) {
  const raw = rawTrueCount(s.runningCount, s.decksRemainingQuarter);
  const actualDecks = s.cardsRemaining / 52;
  return (
    <div className={cn("rounded-xl border p-4", g.tcCorrect ? "border-success/40 bg-success/[0.07]" : "border-destructive/40 bg-destructive/[0.07]")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {g.tcCorrect ? <CheckCircle2 className="mt-0.5 size-5 text-success" /> : <XCircle className="mt-0.5 size-5 text-destructive" />}
          <div className="space-y-1 text-sm">
            <div className="font-semibold">
              {g.timedOut ? "Time's up" : g.tcCorrect ? "Correct" : "Incorrect"} — true count {formatCount(g.expectedTc)}
            </div>
            <p className="tabular text-foreground/85">
              {formatCount(s.runningCount)} ÷ {fmtDecks(s.decksRemainingQuarter)} decks = {raw.toFixed(2)} → {formatCount(g.expectedTc)} ({ROUNDING_LABELS[rounding].toLowerCase()})
            </p>
            {mode === "estimate" && (
              <>
                <p className={cn("tabular", g.deckCorrect ? "text-success" : "text-destructive")}>
                  Deck estimate: {g.deckEstimate !== undefined ? fmtDecks(g.deckEstimate) : "—"} vs actual {actualDecks.toFixed(2)} ({s.cardsRemaining} cards
                  {" "}≈ {fmtDecks(s.decksRemainingQuarter)} decks){g.deckError !== undefined && Number.isFinite(g.deckError) ? ` · off by ${Math.abs(g.deckError).toFixed(2)}` : ""}
                </p>
                <p className={cn("tabular", g.calculationCorrect ? "text-success" : "text-destructive")}>
                  Arithmetic with your estimate:{" "}
                  {g.tcFromOwnEstimate !== undefined && Number.isFinite(g.tcFromOwnEstimate)
                    ? `${formatCount(s.runningCount)} ÷ ${fmtDecks(g.deckEstimate!)} → ${formatCount(g.tcFromOwnEstimate)}; you said ${g.answer !== undefined ? formatCount(g.answer) : "—"}`
                    : "—"}
                </p>
              </>
            )}
            {mode === "calculate" && g.answer !== undefined && !g.tcCorrect && <p className="text-muted-foreground">You answered {formatCount(g.answer)}.</p>}
          </div>
        </div>
        <Button onClick={onNext} size="lg" className="gap-2">
          Next <Kbd>Enter</Kbd>
        </Button>
      </div>
    </div>
  );
}
