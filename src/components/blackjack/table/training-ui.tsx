"use client";

import { useState } from "react";
import { CheckCircle2, Minus, Plus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Kbd, Segmented } from "@/components/training/controls";
import { formatCount, ROUNDING_LABELS, type TrueCountRounding } from "@/lib/blackjack/counting";
import { actionWord, formatTc } from "@/lib/blackjack/deviations/registry";
import type { TableTrainingSettings } from "@/lib/storage/stores";
import { ACTION_LABEL } from "@/lib/training/explain";
import type { CheckpointActual, CheckpointAnswer } from "@/lib/training/table/count-checks";
import type { DecisionRecord, InsuranceRecord, TableHint } from "@/lib/training/table/decisions";
import { MODE_LABELS, type TrainingMode } from "@/lib/training/table/modes";
import type { CheckpointRecord } from "@/lib/training/table/shoe-tracker";
import type { PendingCheck } from "@/lib/training/table/training-table";
import { cn } from "@/lib/utils";

const fmtDecks = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
const fmtTc = (n: number) => (Number.isInteger(n) ? formatCount(n) : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`);

/** Beginner live count. Values come from the animated view, so they change only as cards are revealed. */
export function CountHud({ hud }: { hud: CheckpointActual }) {
  const items: [string, string, string][] = [
    ["Running count", "RC", formatCount(hud.runningCount)],
    ["Decks left", "Decks", `≈${fmtDecks(hud.decksQuarter)}`],
    ["True count", "TC", hud.trueCount === null ? "—" : fmtTc(hud.trueCount)],
    ["Penetration", "Pen.", `${Math.round((hud.cardsDealt / (hud.cardsDealt + hud.cardsRemaining)) * 100)}%`],
    ["Cards dealt", "Dealt", String(hud.cardsDealt)],
  ];
  return (
    <div className="grid grid-cols-5 gap-1 rounded-xl border border-primary/25 bg-card px-2 py-1.5 sm:gap-3 sm:px-4">
      {items.map(([label, short, value]) => (
        <div key={label} className="min-w-0 text-center">
          <div className="truncate text-[9px] tracking-wide text-muted-foreground uppercase sm:text-[10px]">
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </div>
          <div className="tabular text-sm font-semibold text-primary sm:text-lg">{value}</div>
        </div>
      ))}
      {!hud.valid && (
        <p className="col-span-5 text-center text-[11px] text-amber-300">Count invalid for this shoe: it ran out mid-round and the discards were reshuffled.</p>
      )}
    </div>
  );
}

const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

/** Basic strategy and, for index plays, the count-adjusted play shown separately. */
export function HintChip({ hint }: { hint: TableHint }) {
  const basic = hint.insurance ? "No insurance" : hint.basic!.acceptable.map((a) => ACTION_LABEL[a]).join(" or ");
  const d = hint.deviation;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
      <span className="rounded-full bg-primary/15 px-3 py-1 font-medium text-primary">Basic strategy: {basic}</span>
      {d && (
        <span className={cn("rounded-full px-3 py-1 font-medium", d.deviates ? "bg-sky-500/20 text-sky-200" : "bg-muted text-muted-foreground")}>
          Count-adjusted (TC {formatTc(d.trueCount)}): {cap(actionWord(d.countAction))}
          {d.borderline ? " (borderline)" : ""}
        </span>
      )}
      {d && <span className="w-full text-center text-[11px] text-muted-foreground">{d.label}: {d.indexText}{d.deviates ? " The count has crossed the index." : ""}</span>}
    </div>
  );
}

export function InsurancePanel({ max, onDecide }: { max: number; onDecide: (amount: number) => void }) {
  const [amount, setAmount] = useState(max);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="text-sm font-medium">Dealer shows an Ace. Insurance?</span>
      <Button variant="secondary" size="lg" className="h-11 gap-2" onClick={() => onDecide(0)}>
        No insurance <Kbd>N</Kbd>
      </Button>
      {max > 0 && (
        <>
          <Input
            aria-label="Insurance amount"
            type="number"
            min={0}
            max={max}
            step={0.5}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
            className="tabular h-11 w-24 text-center"
          />
          <Button size="lg" className="h-11 gap-2" disabled={amount <= 0} onClick={() => onDecide(amount)}>
            Insure {amount} <Kbd>I</Kbd>
          </Button>
        </>
      )}
      <span className="w-full text-center text-[11px] text-muted-foreground">Pays 2:1 if the dealer has blackjack; up to half your bet ({max}).</span>
    </div>
  );
}

export function InsuranceFeedback({ r }: { r: InsuranceRecord }) {
  const d = r.deviation;
  const ok = r.countCorrect;
  const what = r.chosen === "insure" ? `took insurance (${r.amount})` : "declined insurance";
  return (
    <p className={cn("text-center text-xs", ok ? "text-success" : "text-destructive")}>
      {ok ? "✓" : "✗"} You {what}.{" "}
      {d ? `At TC ${formatTc(d.trueCount)} the count-adjusted play is to ${actionWord(d.countAction)} (${d.indexText})` : "Basic strategy declines insurance."}
    </p>
  );
}

function parse(s: string): number | null {
  const t = s.trim().replace("−", "-").replace("+", "").replace(",", ".");
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function CountCheckPanel({
  pending,
  askTrueCount,
  askDecks,
  rounding,
  deckAssistCards,
  onSubmit,
  onSkip,
}: {
  pending: PendingCheck;
  askTrueCount: boolean;
  askDecks: boolean;
  rounding: TrueCountRounding;
  deckAssistCards: number | null;
  onSubmit: (a: CheckpointAnswer) => void;
  onSkip: () => void;
}) {
  const [rc, setRc] = useState("");
  const [tc, setTc] = useState("");
  const [decks, setDecks] = useState<number | null>(null);
  const endOfShoe = pending.kind === "end-of-shoe";
  const rcN = parse(rc);
  const valid = rcN !== null && Number.isInteger(rcN);

  const title = endOfShoe
    ? "End of shoe: what is your final running count?"
    : pending.trigger === "manual"
      ? "Count check"
      : "Count check: play is paused";

  const submit = () => {
    if (!valid) return;
    onSubmit({
      runningCount: rcN,
      trueCount: askTrueCount && !endOfShoe ? parse(tc) : undefined,
      decks: askDecks && !endOfShoe ? decks : undefined,
    });
  };

  return (
    <form
      className="space-y-3 rounded-xl border border-primary/40 bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Running count</span>
          <Input autoFocus inputMode="numeric" autoComplete="off" value={rc} onChange={(e) => setRc(e.target.value)} className="tabular h-10 w-24 text-center text-lg" />
        </label>
        {askDecks && !endOfShoe && (
          <div className="space-y-1">
            <span className="block text-xs text-muted-foreground">How many decks remain?</span>
            <div className="flex items-center gap-1">
              <Button type="button" variant="secondary" size="icon" aria-label="Quarter deck less" onClick={() => setDecks((d) => Math.max(0.25, (d ?? 1) - 0.25))}>
                <Minus className="size-4" />
              </Button>
              <span className="tabular w-14 text-center text-lg font-semibold">{decks === null ? "?" : fmtDecks(decks)}</span>
              <Button type="button" variant="secondary" size="icon" aria-label="Quarter deck more" onClick={() => setDecks((d) => Math.min(8, (d ?? 0.75) + 0.25))}>
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        )}
        {askTrueCount && !endOfShoe && (
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">True count ({ROUNDING_LABELS[rounding].toLowerCase()})</span>
            <Input inputMode="decimal" autoComplete="off" value={tc} onChange={(e) => setTc(e.target.value)} className="tabular h-10 w-24 text-center text-lg" />
          </label>
        )}
        <Button type="submit" size="lg" disabled={!valid} className="h-10 gap-2">
          Submit <Kbd>Enter</Kbd>
        </Button>
        <Button type="button" variant="ghost" onClick={onSkip} className="h-10">
          Skip
        </Button>
      </div>
      {askDecks && !endOfShoe && deckAssistCards !== null && (
        <p className="text-xs text-muted-foreground">Deck assistance is on: {deckAssistCards} cards remain undealt.</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Decks remaining means all undealt cards, including those behind the cut card. A skipped check is recorded as unanswered.
      </p>
    </form>
  );
}

export function CheckpointFeedback({ cp }: { cp: CheckpointRecord }) {
  const g = cp.grade;
  const a = cp.actual;
  const row = (ok: boolean | null, text: React.ReactNode) => (
    <li className="flex items-start gap-1.5">
      {ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
      <span>{text}</span>
    </li>
  );
  if (!g.answered) return <p className="text-center text-xs text-muted-foreground">Check skipped: recorded as unanswered. Running count was {formatCount(a.runningCount)}.</p>;
  return (
    <ul className="tabular mx-auto max-w-xl space-y-0.5 rounded-xl border border-border bg-card px-4 py-2 text-xs">
      {row(g.rcCorrect, <>Running count: you {formatCount(cp.answer.runningCount!)}, actual {formatCount(a.runningCount)}{!g.rcCorrect && ` (off by ${Math.abs(g.rcError!)})`}</>)}
      {g.decksAsked &&
        row(
          g.deckCorrect,
          <>
            Decks remaining: you {cp.answer.decks != null ? fmtDecks(cp.answer.decks) : "—"}, actual {a.decksRemaining.toFixed(2)} ({a.cardsRemaining} cards)
          </>,
        )}
      {g.tcAsked &&
        row(
          g.tcCorrect,
          <>
            True count: you {cp.answer.trueCount != null ? fmtTc(cp.answer.trueCount) : "—"}, actual {formatCount(a.trueCount!)} ({formatCount(a.runningCount)} ÷ {fmtDecks(a.decksQuarter)})
            {g.arithmeticCorrect !== null && (g.arithmeticCorrect ? " · arithmetic from your own estimates was right" : " · arithmetic from your own estimates was off")}
          </>,
        )}
    </ul>
  );
}

export function DecisionFeedback({ d }: { d: DecisionRecord }) {
  if (d.correct === null)
    return <p className="text-center text-xs text-muted-foreground">{ACTION_LABEL[d.chosen]}: not graded. {d.notes[0]}</p>;
  const dev = d.deviation;
  if (dev) {
    const ok = d.countCorrect;
    const msg =
      dev.outcome === "followed"
        ? `deviation made: at TC ${formatTc(dev.trueCount)}, ${actionWord(dev.countAction)} instead of basic ${actionWord(dev.basic)}.`
        : dev.outcome === "missed"
          ? `missed deviation: at TC ${formatTc(dev.trueCount)} the count calls for ${actionWord(dev.countAction)} (basic is ${actionWord(dev.basic)}).`
          : dev.outcome === "wrong-deviation"
            ? `deviation not due: at TC ${formatTc(dev.trueCount)} basic strategy (${actionWord(dev.basic)}) still applies.`
            : ok
              ? `matches the count-adjusted play at TC ${formatTc(dev.trueCount)}.`
              : `the count-adjusted play at TC ${formatTc(dev.trueCount)} is ${actionWord(dev.countAction)}.`;
    return (
      <p className={cn("text-center text-xs", ok ? "text-success" : "text-destructive")}>
        {ok ? "✓" : "✗"} {ACTION_LABEL[d.chosen]}: {msg} <span className="text-muted-foreground">{dev.label}: {dev.indexText}</span>
      </p>
    );
  }
  return (
    <p className={cn("text-center text-xs", d.correct ? "text-success" : "text-destructive")}>
      {d.correct ? (
        <>✓ {ACTION_LABEL[d.chosen]} matches basic strategy.</>
      ) : (
        <>
          ✗ You chose {ACTION_LABEL[d.chosen].toLowerCase()}; basic strategy is {ACTION_LABEL[d.best!].toLowerCase()} (estimated EV loss {((d.evLoss ?? 0) * 100).toFixed(1)}% of the bet
          {d.quality === "approximate" ? ", approximate" : ""}).
        </>
      )}
    </p>
  );
}

export function TrainingSettingsPanel({
  value,
  onChange,
}: {
  value: TableTrainingSettings;
  onChange: (patch: Partial<TableTrainingSettings>) => void;
}) {
  const cp = value.checkpoints;
  const setCp = (p: Partial<typeof cp>) => onChange({ checkpoints: { ...cp, ...p } });
  const toggle = (label: string, checked: boolean, on: (v: boolean) => void, hint?: string) => (
    <label className="flex items-start gap-2 text-sm" title={hint}>
      <input type="checkbox" className="mt-1 accent-[var(--primary)]" checked={checked} onChange={(e) => on(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <Field label="Training mode" hint={MODE_HINT[value.mode]}>
        <Segmented
          value={value.mode}
          onChange={(mode) => onChange({ mode })}
          options={(Object.keys(MODE_LABELS) as TrainingMode[]).map((m) => ({ value: m, label: MODE_LABELS[m] }))}
        />
      </Field>
      {value.mode === "intermediate" && (
        <div className="space-y-1.5">
          {toggle("Show basic-strategy hints", value.intermediate.hints, (hints) => onChange({ intermediate: { ...value.intermediate, hints } }))}
          {toggle("Immediate decision feedback", value.intermediate.immediateFeedback, (immediateFeedback) =>
            onChange({ intermediate: { ...value.intermediate, immediateFeedback } }),
          )}
        </div>
      )}
      <Field label="Automatic count checks">
        <Segmented
          value={cp.every}
          onChange={(every) => setCp({ every })}
          options={[
            { value: 0, label: "Off" },
            { value: 3, label: "~3 rounds" },
            { value: 5, label: "~5" },
            { value: 8, label: "~8" },
          ]}
        />
      </Field>
      <div className="space-y-1.5">
        {cp.every > 0 && toggle("Random timing (otherwise exactly every N rounds)", cp.random, (random) => setCp({ random }))}
        {toggle("Ask for the true count", cp.askTrueCount, (askTrueCount) => setCp({ askTrueCount }))}
        {toggle("Ask how many decks remain", cp.askDecks, (askDecks) => setCp({ askDecks }))}
        {cp.askDecks && toggle("Deck assistance: show undealt cards", cp.deckAssist, (deckAssist) => setCp({ deckAssist }))}
        {toggle(
          value.mode === "casino" ? "End-of-shoe count check (always on in Casino)" : "End-of-shoe count check",
          cp.endOfShoe || value.mode === "casino",
          (endOfShoe) => setCp({ endOfShoe }),
        )}
        {toggle("Grade count-based deviations (index plays)", value.deviations, (deviations) => onChange({ deviations }))}
        {toggle("Save full decision log with shoe reports", value.keepDecisionDetail, (keepDecisionDetail) => onChange({ keepDecisionDetail }), "Uses more browser storage; kept for the 20 most recent shoes.")}
      </div>
    </div>
  );
}

const MODE_HINT: Record<TrainingMode, string> = {
  beginner: "Live running count, true count and penetration, with strategy hints and instant feedback.",
  intermediate: "Count hidden. Check yourself any time; hints and feedback are optional.",
  casino: "No assistance. Play the shoe; everything is reviewed in the end-of-shoe report.",
};
