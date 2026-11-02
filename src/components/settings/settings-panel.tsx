"use client";

import { useState } from "react";
import { Download, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Segmented } from "@/components/training/controls";
import { StrategyChart } from "@/components/training/strategy-chart";
import { useSettings, useStats } from "@/hooks/use-store";
import { ROUNDING_LABELS, type TrueCountRounding } from "@/lib/blackjack/counting";
import { DECK_OPTIONS, DEFAULT_RULES, describeRules, RULE_PRESETS, validateRules, type TableRules } from "@/lib/blackjack/rules";
import { DEFAULT_SETTINGS } from "@/lib/storage/stores";
import { emptyStats } from "@/lib/training/stats";

const yesNo = [
  { value: 1, label: "Yes" },
  { value: 0, label: "No" },
] as const;

export function SettingsPanel() {
  const [settings, setSettings] = useSettings();
  const [stats, setStats] = useStats();
  const [confirmReset, setConfirmReset] = useState(false);
  const rules = settings.rules;
  const setRules = (patch: Partial<TableRules>) => setSettings((s) => ({ ...s, rules: { ...s.rules, ...patch } }));
  const errors = validateRules(rules);

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ settings, stats }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bjtrain-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Table rules</h2>
            <p className="text-xs text-muted-foreground">{describeRules(rules)}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RULE_PRESETS.map((p) => (
              <Button key={p.id} variant="secondary" size="sm" title={p.description} onClick={() => setSettings((s) => ({ ...s, rules: p.rules }))}>
                {p.name}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Decks">
            <Segmented value={rules.decks} onChange={(decks) => setRules({ decks })} options={DECK_OPTIONS.map((d) => ({ value: d, label: d }))} />
          </Field>
          <Field label="Dealer soft 17">
            <Segmented
              value={rules.dealerHitsSoft17 ? 1 : 0}
              onChange={(v) => setRules({ dealerHitsSoft17: v === 1 })}
              options={[
                { value: 1, label: "Hits (H17)" },
                { value: 0, label: "Stands (S17)" },
              ]}
            />
          </Field>
          <Field label="Blackjack pays">
            <Segmented
              value={rules.blackjackPayout}
              onChange={(blackjackPayout) => setRules({ blackjackPayout })}
              options={[
                { value: "3:2", label: "3:2" },
                { value: "6:5", label: "6:5" },
              ]}
            />
          </Field>
          <Field label="Double after split">
            <Segmented value={rules.doubleAfterSplit ? 1 : 0} onChange={(v) => setRules({ doubleAfterSplit: v === 1 })} options={yesNo} />
          </Field>
          <Field label="Double on">
            <Segmented
              value={rules.doubleRestriction}
              onChange={(doubleRestriction) => setRules({ doubleRestriction })}
              options={[
                { value: "any2", label: "Any two cards" },
                { value: "9-11", label: "9–11" },
                { value: "10-11", label: "10–11" },
              ]}
            />
          </Field>
          <Field label="Surrender">
            <Segmented
              value={rules.surrender}
              onChange={(surrender) => setRules({ surrender })}
              options={[
                { value: "none", label: "None" },
                { value: "late", label: "Late" },
              ]}
            />
          </Field>
          <Field label="Insurance against an Ace">
            <Segmented value={rules.insurance ? 1 : 0} onChange={(v) => setRules({ insurance: v === 1 })} options={yesNo} />
          </Field>
          <Field label="Maximum hands after splitting">
            <Segmented value={rules.maxSplitHands} onChange={(maxSplitHands) => setRules({ maxSplitHands })} options={[2, 3, 4].map((n) => ({ value: n as 2 | 3 | 4, label: n }))} />
          </Field>
          <Field label="Resplit aces">
            <Segmented value={rules.resplitAces ? 1 : 0} onChange={(v) => setRules({ resplitAces: v === 1 })} options={yesNo} />
          </Field>
          <Field label="Split aces draw more than one card">
            <Segmented value={rules.hitSplitAces ? 1 : 0} onChange={(v) => setRules({ hitSplitAces: v === 1 })} options={yesNo} />
          </Field>
          <Field label={`Cut-card penetration: ${Math.round(rules.penetration * 100)}%`}>
            <input
              type="range"
              min={50}
              max={90}
              value={Math.round(rules.penetration * 100)}
              onChange={(e) => setRules({ penetration: Number(e.target.value) / 100 })}
              className="w-full accent-[var(--primary)]"
            />
          </Field>
          <Field label="AI players" hint="Other players at the simulator table.">
            <Segmented value={rules.aiPlayers} onChange={(aiPlayers) => setRules({ aiPlayers })} options={[0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: n }))} />
          </Field>
          <Field label="Table limits" hint="Used by the table simulator.">
            <div className="flex items-center gap-2 text-sm">
              <NumberInput value={rules.minBet} onChange={(minBet) => setRules({ minBet })} />
              <span className="text-muted-foreground">to</span>
              <NumberInput value={rules.maxBet} onChange={(maxBet) => setRules({ maxBet })} />
            </div>
          </Field>
        </div>
        {errors.length > 0 && <p className="mt-4 text-sm text-destructive">{errors.join(" ")}</p>}

        <div className="mt-5 space-y-1 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
          <p>
            Assumed for every ruleset: US hole card with dealer peek (no ENHC), late surrender only, a split 21 is not a blackjack, and insurance
            (when enabled) is offered only against an Ace. Basic strategy is recomputed for the deck count and soft-17 rule, and applied with your DAS, doubling and surrender settings.
          </p>
          <p>
            Non-standard games (such as Blackjack Elite at El Dorado Hills) are not available. They can be added as a rules variant once their official
            rules and a verified strategy exist.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="mt-3 gap-1.5" onClick={() => setSettings((s) => ({ ...s, rules: DEFAULT_RULES }))}>
          <RotateCcw className="size-3.5" /> Reset to default rules
        </Button>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 font-semibold">Basic strategy for these rules</h2>
        <p className="mb-4 text-xs text-muted-foreground">Computed by exact combinatorial analysis. Updates when you change the rules above.</p>
        <StrategyChart rules={rules} />
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 font-semibold">Counting</h2>
          <Field label="True-count rounding" hint="Truncation toward zero is the most common Hi-Lo convention.">
            <select
              value={settings.rounding}
              onChange={(e) => setSettings((s) => ({ ...s, rounding: e.target.value as TrueCountRounding }))}
              className="h-8 w-full max-w-xs rounded-lg border border-input bg-input/30 px-2 text-sm"
            >
              {(Object.keys(ROUNDING_LABELS) as TrueCountRounding[]).map((r) => (
                <option key={r} value={r}>
                  {ROUNDING_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-1 font-semibold">Data</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Everything is stored in this browser only. {stats.bs.overall.attempts + stats.rc.drills.attempts + stats.tc.calculate.attempts} recorded answers.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" className="gap-1.5" onClick={exportData}>
              <Download className="size-3.5" /> Export JSON
            </Button>
            {confirmReset ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setStats(emptyStats());
                    setConfirmReset(false);
                  }}
                >
                  Yes, erase all statistics
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setConfirmReset(true)}>
                <Trash2 className="size-3.5" /> Reset statistics
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSettings(DEFAULT_SETTINGS)}>
              Reset all settings
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function NumberInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <input
      type="number"
      min={1}
      value={value}
      onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
      className="tabular h-8 w-24 rounded-lg border border-input bg-input/30 px-2 text-sm"
    />
  );
}
