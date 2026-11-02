"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Pause, Play, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayingCard } from "@/components/blackjack/playing-card";
import { Field, Kbd, Segmented, StatTile, formatMs, pct } from "@/components/training/controls";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useSettings, useStats } from "@/hooks/use-store";
import type { Card } from "@/lib/blackjack/cards";
import { formatCount, hiLoValue, runningCount } from "@/lib/blackjack/counting";
import { defaultRng } from "@/lib/blackjack/rng";
import { createDrill, cardsShown, DEFAULT_RC_CONFIG, expectedCount, RC_DRILL_LABELS, type RCConfig, type RCDrill, type RCDrillType } from "@/lib/training/running-count";
import { accuracy, recordRcDrill, recordRcFlashcard, recordSession, type Tally } from "@/lib/training/stats";
import { cn } from "@/lib/utils";

type Phase = "idle" | "running" | "paused" | "answer" | "result";

const DRILL_TYPES: RCDrillType[] = ["flashcard", "sequence", "simultaneous", "deck", "doubleDeck", "timed"];

export function RunningCountTrainer() {
  const [settings, setSettings] = useSettings();
  const config = settings.rc;
  const setConfig = (patch: Partial<RCConfig>) => setSettings((s) => ({ ...s, rc: { ...s.rc, ...patch } }));
  const [stats, setStats] = useStats();
  const sessionCounted = useRef(false);

  const countSession = useCallback(
    (s: typeof stats) => {
      if (sessionCounted.current) return s;
      sessionCounted.current = true;
      return recordSession(s, "rc");
    },
    [],
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <Segmented
          ariaLabel="Drill type"
          size="md"
          value={config.type}
          onChange={(type) => setConfig({ type })}
          options={DRILL_TYPES.map((t) => ({ value: t, label: RC_DRILL_LABELS[t] }))}
        />
        {config.type === "flashcard" ? (
          <Flashcards key="flash" decks={config.decks} onRecord={(correct, ms) => setStats((s) => countSession(recordRcFlashcard(s, Date.now(), correct, ms)))} />
        ) : (
          <Drill key={config.type} config={config} onRecord={(a) => setStats((s) => countSession(recordRcDrill(s, a)))} />
        )}
      </div>

      <aside className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Drill accuracy" value={pct(accuracy(stats.rc.drills))} sub={`${stats.rc.drills.attempts} drills`} />
          <StatTile label="Flashcards" value={pct(accuracy(stats.rc.flashcards))} sub={`${stats.rc.flashcards.attempts} cards`} />
          <StatTile label="Best deck" value={stats.rc.bestDeckMs ? formatMs(stats.rc.bestDeckMs) : "—"} sub="1-deck countdown" />
          <StatTile label="Best 2-deck" value={stats.rc.bestDoubleDeckMs ? formatMs(stats.rc.bestDoubleDeckMs) : "—"} sub="2-deck countdown" />
        </div>
        <DrillSettings config={config} setConfig={setConfig} />
        <div className="rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">Hi-Lo tags</div>
          <div className="tabular grid grid-cols-3 gap-1 text-center">
            <span className="rounded bg-success/15 py-1 text-success">2–6 = +1</span>
            <span className="rounded bg-muted py-1">7–9 = 0</span>
            <span className="rounded bg-destructive/15 py-1 text-destructive">10–A = −1</span>
          </div>
          <p className="mt-2">Every drill deals from a real shuffled shoe without replacement. Personal bests only count correct answers.</p>
        </div>
      </aside>
    </div>
  );
}

function DrillSettings({ config, setConfig }: { config: RCConfig; setConfig: (p: Partial<RCConfig>) => void }) {
  const t = config.type;
  const isCountdown = t === "deck" || t === "doubleDeck";
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      {t !== "flashcard" && t !== "timed" && (
        <Field label="Pacing">
          <Segmented
            value={config.pacing}
            onChange={(pacing) => setConfig({ pacing })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "manual", label: "Self-paced" },
            ]}
          />
        </Field>
      )}
      {t !== "flashcard" && (config.pacing === "auto" || t === "timed") && (
        <Field label={`Speed: ${config.speedMs} ms per ${t === "simultaneous" ? "group" : "card"}`}>
          <input
            type="range"
            min={200}
            max={3000}
            step={50}
            value={config.speedMs}
            onChange={(e) => setConfig({ speedMs: Number(e.target.value) })}
            className="w-full accent-[var(--primary)]"
          />
        </Field>
      )}
      {(t === "sequence" || t === "simultaneous") && (
        <Field label={`Cards per drill: ${config.sequenceLength}`}>
          <input
            type="range"
            min={4}
            max={52}
            value={config.sequenceLength}
            onChange={(e) => setConfig({ sequenceLength: Number(e.target.value) })}
            className="w-full accent-[var(--primary)]"
          />
        </Field>
      )}
      {t === "simultaneous" && (
        <Field label="Cards shown together">
          <Segmented value={config.groupSize} onChange={(groupSize) => setConfig({ groupSize })} options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: n }))} />
        </Field>
      )}
      {t === "timed" && (
        <Field label="Duration">
          <Segmented value={config.timedSeconds} onChange={(timedSeconds) => setConfig({ timedSeconds })} options={[15, 30, 60, 120].map((n) => ({ value: n, label: `${n}s` }))} />
        </Field>
      )}
      {isCountdown && (
        <Field label="Hidden cards" hint="Cards removed unseen before the countdown so the answer isn't always 0. Set to 0 to verify the count returns to zero.">
          <Segmented value={config.hiddenCards} onChange={(hiddenCards) => setConfig({ hiddenCards })} options={[0, 1, 2, 3, 5].map((n) => ({ value: n, label: n }))} />
        </Field>
      )}
      {!isCountdown && (
        <Field label="Shoe">
          <Segmented value={config.decks} onChange={(decks) => setConfig({ decks })} options={[1, 2, 6, 8].map((n) => ({ value: n, label: `${n}D` }))} />
        </Field>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Drill({ config, onRecord }: { config: RCConfig; onRecord: (a: Parameters<typeof recordRcDrill>[1]) => void }) {
  const rng = useMemo(() => defaultRng(), []);
  const [drill, setDrill] = useState<RCDrill | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [shown, setShown] = useState(0); // groups revealed so far
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<{ expected: number; answer: number; ms: number; cards: number } | null>(null);
  const clock = useRef({ start: 0, pausedTotal: 0, pausedAt: 0 });
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const auto = config.type === "timed" || config.pacing === "auto";

  const now = () => performance.now();
  const activeMs = useCallback(() => {
    const c = clock.current;
    const pausedNow = c.pausedAt ? now() - c.pausedAt : 0;
    return now() - c.start - c.pausedTotal - pausedNow;
  }, []);

  const start = useCallback(() => {
    const d = createDrill(config, rng);
    setDrill(d);
    setShown(1);
    setAnswer("");
    setResult(null);
    clock.current = { start: now(), pausedTotal: 0, pausedAt: 0 };
    setPhase("running");
  }, [config, rng]);

  const finishShowing = useCallback(() => {
    setPhase("answer");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const advance = useCallback(() => {
    if (!drill || phase !== "running") return;
    if (shown >= drill.groups.length) finishShowing();
    else setShown(shown + 1);
  }, [drill, phase, shown, finishShowing]);

  // Auto-advance timer.
  useEffect(() => {
    if (phase !== "running" || !auto || !drill) return;
    const id = setTimeout(() => {
      if (config.type === "timed" && activeMs() >= config.timedSeconds * 1000) finishShowing();
      else if (shown >= drill.groups.length) finishShowing();
      else setShown((n) => n + 1);
    }, config.speedMs);
    return () => clearTimeout(id);
  }, [phase, auto, drill, shown, config.speedMs, config.type, config.timedSeconds, activeMs, finishShowing]);

  // Elapsed display.
  useEffect(() => {
    if (phase !== "running" && phase !== "answer") return;
    const id = setInterval(() => setElapsed(activeMs()), 100);
    return () => clearInterval(id);
  }, [phase, activeMs]);

  const pause = () => {
    if (phase === "running") {
      clock.current.pausedAt = now();
      setPhase("paused");
    } else if (phase === "paused") {
      clock.current.pausedTotal += now() - clock.current.pausedAt;
      clock.current.pausedAt = 0;
      setPhase("running");
    }
  };

  const submit = () => {
    if (!drill || phase !== "answer") return;
    const n = Number(answer.replace("−", "-").replace("+", ""));
    if (answer.trim() === "" || !Number.isInteger(n)) return;
    const ms = activeMs();
    const expected = expectedCount(drill, shown);
    const cards = cardsShown(drill, shown);
    setResult({ expected, answer: n, ms, cards });
    setPhase("result");
    onRecord({ at: Date.now(), type: config.type, expected, answer: n, ms, cards });
  };

  useHotkeys(
    {
      enter: () => (phase === "idle" || phase === "result" ? start() : phase === "answer" ? submit() : undefined),
      " ": () => (phase === "running" && !auto ? advance() : phase === "idle" || phase === "result" ? start() : undefined),
      arrowright: () => phase === "running" && !auto && advance(),
      escape: () => (auto ? pause() : undefined),
    },
    { allowInInputs: ["enter"] },
  );

  const group = drill && shown > 0 ? drill.groups[Math.min(shown, drill.groups.length) - 1] : null;
  const total = drill?.groups.length ?? 0;
  const isCountdown = config.type === "deck" || config.type === "doubleDeck";

  return (
    <div className="space-y-4">
      <div className="felt relative flex min-h-[320px] flex-col items-center justify-center rounded-2xl px-4 py-6">
        {phase === "idle" && (
          <div className="text-center">
            <p className="mb-4 max-w-sm text-sm text-amber-50/80">{drillBlurb(config)}</p>
            <Button size="lg" onClick={start} className="gap-2">
              <Play className="size-4" /> Start <Kbd>Enter</Kbd>
            </Button>
          </div>
        )}
        {(phase === "running" || phase === "paused") && group && (
          <>
            <div className={cn("flex flex-wrap justify-center gap-2 transition-opacity", phase === "paused" && "opacity-0")}>
              {group.map((c) => (
                <PlayingCard key={c.id} card={c} size="lg" />
              ))}
            </div>
            {phase === "paused" && <div className="absolute text-lg font-medium text-amber-50">Paused</div>}
          </>
        )}
        {phase === "answer" && (
          <form
            className="flex flex-col items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor="rc-answer" className="text-sm text-amber-50/85">
              {isCountdown && drill?.hidden.length ? `Running count of the ${cardsShown(drill, shown)} cards shown?` : "What is the running count?"}
            </label>
            <Input
              id="rc-answer"
              ref={inputRef}
              autoFocus
              inputMode="numeric"
              autoComplete="off"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className="tabular h-12 w-32 bg-black/30 text-center text-2xl"
              placeholder="0"
            />
            <Button type="submit" size="lg">
              Submit <Kbd>Enter</Kbd>
            </Button>
          </form>
        )}
        {phase === "result" && result && drill && (
          <div className="text-center">
            <div className="mb-2 flex items-center justify-center gap-2 text-lg font-semibold text-amber-50">
              {result.answer === result.expected ? (
                <>
                  <CheckCircle2 className="size-5 text-success" /> Correct
                </>
              ) : (
                <>
                  <XCircle className="size-5 text-destructive" /> Off by {Math.abs(result.answer - result.expected)}
                </>
              )}
            </div>
            <p className="tabular text-sm text-amber-50/80">
              Running count {formatCount(result.expected)} · you said {formatCount(result.answer)} · {result.cards} cards in {formatMs(result.ms)}
            </p>
            {isCountdown && (
              <p className="mt-1 text-xs text-amber-50/60">
                {drill.hidden.length === 0
                  ? `Full ${config.type === "deck" ? "deck" : "double deck"} counted: a balanced count must end at 0.`
                  : `Hidden cards: ${drill.hidden.map((c) => c.rank).join(", ")} (count ${formatCount(runningCount(drill.hidden))}). Shown + hidden = ${formatCount(result.expected + runningCount(drill.hidden))}.`}
              </p>
            )}
            <Button size="lg" onClick={start} className="mt-4 gap-2">
              <RotateCcw className="size-4" /> Again <Kbd>Enter</Kbd>
            </Button>
          </div>
        )}
      </div>

      {(phase === "running" || phase === "paused" || phase === "answer") && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="h-1.5 min-w-40 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{
                width: `${config.type === "timed" ? Math.min(100, (elapsed / (config.timedSeconds * 1000)) * 100) : (shown / Math.max(1, total)) * 100}%`,
              }}
            />
          </div>
          <span className="tabular text-muted-foreground">
            {config.type === "timed" ? `${Math.max(0, config.timedSeconds - Math.floor(elapsed / 1000))}s left` : `${cardsShown(drill!, shown)}/${cardsShown(drill!)} cards`} · {formatMs(elapsed)}
          </span>
          {phase !== "answer" && auto && (
            <Button variant="secondary" size="sm" onClick={pause} className="gap-1.5">
              {phase === "paused" ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {phase === "paused" ? "Resume" : "Pause"} <Kbd>Esc</Kbd>
            </Button>
          )}
          {phase === "running" && !auto && (
            <Button variant="secondary" size="sm" onClick={advance}>
              {shown >= total ? "Finish" : "Next"} <Kbd>Space</Kbd>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function drillBlurb(c: RCConfig): string {
  switch (c.type) {
    case "sequence":
      return `${c.sequenceLength} cards, one at a time. Keep the running count, then enter it.`;
    case "simultaneous":
      return `Cards appear ${c.groupSize} at a time, like a dealt hand. Count each group as a unit.`;
    case "deck":
      return "Count down a full single deck. Time runs from the first card until you submit.";
    case "doubleDeck":
      return "Count down two full decks (104 cards). Time runs until you submit.";
    case "timed":
      return `Cards stream for ${c.timedSeconds} seconds at ${c.speedMs} ms each. Enter the count when time is up.`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------

function Flashcards({ decks, onRecord }: { decks: number; onRecord: (correct: boolean, ms: number) => void }) {
  const rng = useMemo(() => defaultRng(), []);
  const [cards, setCards] = useState<readonly Card[]>([]);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; value: number } | null>(null);
  const [session, setSession] = useState<Tally>({ attempts: 0, correct: 0 });
  const shownAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const deal = useCallback(() => {
    const d = createDrill({ ...DEFAULT_RC_CONFIG, type: "flashcard", decks }, rng);
    setCards(d.groups.map((g) => g[0]));
    setIndex(0);
    shownAt.current = performance.now();
  }, [decks, rng]);

  useEffect(() => {
    deal();
    return () => clearTimeout(timer.current);
  }, [deal]);

  const nextCard = useCallback(() => {
    setFeedback(null);
    if (index + 1 >= cards.length) deal();
    else setIndex(index + 1);
    shownAt.current = performance.now();
  }, [index, cards.length, deal]);

  const answer = (v: number) => {
    const card = cards[index];
    if (!card || feedback) return;
    const value = hiLoValue(card.rank);
    const correct = v === value;
    setFeedback({ correct, value });
    setSession((s) => ({ attempts: s.attempts + 1, correct: s.correct + (correct ? 1 : 0) }));
    onRecord(correct, performance.now() - shownAt.current);
    timer.current = setTimeout(nextCard, correct ? 250 : 1100);
  };

  useHotkeys({ "1": () => answer(-1), "-": () => answer(-1), "2": () => answer(0), "0": () => answer(0), "3": () => answer(1), "=": () => answer(1), "+": () => answer(1) });

  const card = cards[index];
  return (
    <div className="space-y-4">
      <div className="felt flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl px-4 py-6">
        {card && <PlayingCard card={card} size="lg" />}
        <div className="h-6 text-sm font-medium">
          {feedback && (
            <span className={feedback.correct ? "text-success" : "text-destructive"}>
              {feedback.correct ? "Correct" : `Incorrect — ${card?.rank} is ${formatCount(feedback.value)}`}
            </span>
          )}
        </div>
      </div>
      <div className="flex justify-center gap-2">
        {[
          [-1, "−1", "1"],
          [0, "0", "2"],
          [1, "+1", "3"],
        ].map(([v, label, key]) => (
          <Button key={label} variant="secondary" size="lg" className="tabular h-12 w-24 gap-2 text-base" onClick={() => answer(v as number)}>
            {label} <Kbd>{key}</Kbd>
          </Button>
        ))}
      </div>
      <p className="tabular text-center text-xs text-muted-foreground">
        Session {session.correct}/{session.attempts} · {pct(accuracy(session))} · card {index + 1} of {cards.length} from a {decks}-deck shoe
      </p>
    </div>
  );
}
