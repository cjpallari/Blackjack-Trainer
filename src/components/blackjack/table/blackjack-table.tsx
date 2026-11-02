"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, FastForward, Info, RotateCcw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Kbd, Segmented, StatTile } from "@/components/training/controls";
import { Chip, DealerSpot, SeatSpot, ShoeGraphic, TrayGraphic } from "@/components/blackjack/table/table-parts";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useSettings } from "@/hooks/use-store";
import { useTableController } from "@/hooks/use-table";
import { describeRules, type TableRules } from "@/lib/blackjack/rules";
import type { PlayerAction } from "@/lib/blackjack/strategy";
import { MAX_SEATS } from "@/lib/blackjack/table-session";
import type { TableView } from "@/lib/blackjack/table-view";
import type { AnimationSpeed } from "@/lib/storage/stores";
import { ACTION_LABEL } from "@/lib/training/explain";
import { cn } from "@/lib/utils";

const ACTIONS: { action: PlayerAction; key: string }[] = [
  { action: "hit", key: "H" },
  { action: "stand", key: "S" },
  { action: "double", key: "D" },
  { action: "split", key: "P" },
  { action: "surrender", key: "R" },
];

const CHIPS = [5, 25, 100, 500];

const SPEEDS: { value: AnimationSpeed; label: string }[] = [
  { value: "instant", label: "Instant" },
  { value: "fast", label: "Fast" },
  { value: "normal", label: "Normal" },
  { value: "slow", label: "Slow" },
];

const money = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const signed = (n: number) => (n > 0 ? `+${money(n)}` : money(n));

export function BlackjackTable() {
  const [settings, setSettings] = useSettings();
  const { rules, sim } = settings;
  const t = useTableController();
  const view = t.view;
  const [bet, setBet] = useState(sim.lastBet);

  // Keep the pending bet within table limits when rules change.
  useEffect(() => {
    setBet((b) => Math.min(rules.maxBet, Math.max(rules.minBet, b)));
  }, [rules.minBet, rules.maxBet]);

  const human = view?.seats.find((s) => s.kind === "human");
  const betting = !!view && (view.phase === "idle" || view.settled);
  const myTurn = !!view && view.phase === "playerTurn" && view.available.length > 0;
  const pendingError = t.betError(bet);
  const chips = CHIPS.filter((c) => c <= rules.maxBet);

  const deal = () => {
    if (!betting || pendingError) return;
    setSettings((s) => ({ ...s, sim: { ...s.sim, lastBet: bet } }));
    t.deal(bet);
  };
  const addChip = (c: number) => betting && setBet((b) => Math.min(rules.maxBet, b + c));
  const setSim = (patch: Partial<typeof sim>) => setSettings((s) => ({ ...s, sim: { ...s.sim, ...patch } }));

  useHotkeys({
    h: () => t.act("hit"),
    s: () => t.act("stand"),
    d: () => t.act("double"),
    p: () => t.act("split"),
    r: () => t.act("surrender"),
    enter: () => (t.animating ? t.skipAnimation() : deal()),
    " ": () => (t.animating ? t.skipAnimation() : deal()),
    "1": () => chips[0] && addChip(chips[0]),
    "2": () => chips[1] && addChip(chips[1]),
    "3": () => chips[2] && addChip(chips[2]),
    "4": () => chips[3] && addChip(chips[3]),
    backspace: () => betting && setBet(0),
  });

  const seatCountNow = Math.min(MAX_SEATS, rules.aiPlayers + 1);
  const wager = human?.hands.reduce((n, h) => n + h.bet, 0) ?? 0;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        <Felt view={view} rules={rules} instant={sim.animation === "instant"} />

        <div className="flex min-h-14 flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
          {!view && <span className="text-sm text-muted-foreground">Setting up the table…</span>}
          {view && t.animating && (
            <Button variant="secondary" onClick={t.skipAnimation} className="gap-2">
              <FastForward className="size-4" /> Skip animation <Kbd>Space</Kbd>
            </Button>
          )}
          {myTurn &&
            ACTIONS.map(({ action, key }) => (
              <Button
                key={action}
                size="lg"
                variant="secondary"
                disabled={!view!.available.includes(action)}
                onClick={() => t.act(action)}
                className="h-11 min-w-[5.5rem] gap-2 disabled:opacity-30"
              >
                {ACTION_LABEL[action]} <Kbd>{key}</Kbd>
              </Button>
            ))}
          {view && view.phase === "playerTurn" && !myTurn && !t.animating && <span className="text-sm text-muted-foreground">Waiting for other players…</span>}
          {view && betting && !t.animating && (
            <>
              <div className="flex items-center gap-1.5">
                {chips.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => addChip(c)}
                    className="rounded-full text-[18px] transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    title={`Add ${c} (key ${i + 1})`}
                  >
                    <Chip amount={c} />
                  </button>
                ))}
              </div>
              <div className="tabular min-w-24 px-2 text-center">
                <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Bet</div>
                <div className="text-lg font-semibold">{money(bet)}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setBet(0)} disabled={bet === 0}>
                Clear <Kbd>⌫</Kbd>
              </Button>
              <Button size="lg" onClick={deal} disabled={!!pendingError} className="h-11 min-w-28 gap-2">
                Deal <Kbd>Enter</Kbd>
              </Button>
              {pendingError && bet > 0 && <span className="w-full text-center text-xs text-destructive">{pendingError}</span>}
            </>
          )}
        </div>
        {t.error && <p className="text-center text-xs text-destructive">{t.error}</p>}
      </div>

      <aside className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Bankroll" value={human ? money(human.bankroll) : "—"} sub={t.stats.buyIns ? `incl. ${money(t.stats.buyIns)} rebuys` : `started ${money(sim.startingBankroll)}`} />
          <StatTile label="On the table" value={money(betting ? 0 : wager)} sub={human?.roundNet !== undefined ? `last round ${signed(human.roundNet)}` : " "} />
          <StatTile label="Rounds" value={t.stats.rounds} sub={`${t.stats.hands} hands · ${t.stats.blackjacks} BJ`} />
          <StatTile label="W / L / P" value={`${t.stats.wins}/${t.stats.losses}/${t.stats.pushes}`} sub={t.stats.surrenders ? `${t.stats.surrenders} surrendered` : " "} />
          <StatTile
            label="Session net"
            value={signed(t.stats.net)}
            sub={t.stats.wagered ? `${((t.stats.net / t.stats.wagered) * 100).toFixed(1)}% of ${money(t.stats.wagered)} wagered` : "nothing wagered yet"}
            className="col-span-2"
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Session results are mostly variance. A few hundred hands cannot show whether a game or strategy has a positive edge.
        </p>

        {human && human.bankroll < rules.minBet && betting && (
          <Button variant="secondary" className="w-full" onClick={() => t.rebuy(sim.startingBankroll)}>
            Out of chips: rebuy {money(sim.startingBankroll)}
          </Button>
        )}

        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          <Field label="Dealing speed">
            <Segmented value={sim.animation} onChange={(animation) => setSim({ animation })} options={SPEEDS} />
          </Field>
          <Field label="Other players" hint={t.locked ? "Finish the round to change seating." : "Changing seating starts a new table with a fresh shoe."}>
            <Segmented
              value={rules.aiPlayers}
              onChange={(aiPlayers) => !t.locked && setSettings((s) => ({ ...s, rules: { ...s.rules, aiPlayers }, sim: { ...s.sim, humanSeat: Math.min(s.sim.humanSeat, aiPlayers) } }))}
              options={[0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: n }))}
            />
          </Field>
          {seatCountNow > 1 && (
            <Field label="Your seat" hint="Seat 1 is first base (dealt first, on the dealer's left).">
              <Segmented
                value={Math.min(sim.humanSeat, seatCountNow - 1)}
                onChange={(humanSeat) => !t.locked && setSim({ humanSeat })}
                options={Array.from({ length: seatCountNow }, (_, i) => ({ value: i, label: i + 1 }))}
              />
            </Field>
          )}
          <Field label="Starting bankroll">
            <Segmented
              value={sim.startingBankroll}
              onChange={(startingBankroll) => !t.locked && setSim({ startingBankroll })}
              options={[500, 1000, 5000, 25000].map((n) => ({ value: n, label: n.toLocaleString() }))}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" className="gap-1.5" disabled={t.locked} onClick={t.newTable}>
              <RotateCcw className="size-3.5" /> New table
            </Button>
            <span className="text-xs text-muted-foreground">Resets bankroll and shoe.</span>
          </div>
        </div>

        <div className="space-y-1.5 rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
          <p className="text-sm text-foreground">{describeRules(rules)}</p>
          <p>
            Limits {money(rules.minBet)}–{money(rules.maxBet)} · {Math.round(rules.penetration * 100)}% penetration · split to {rules.maxSplitHands} hands
            {rules.resplitAces ? " · resplit aces" : ""}
          </p>
          <p>Other players bet the minimum and play basic strategy. Insurance is not offered.</p>
          <Link href="/settings" className="text-primary hover:underline">
            Change table rules →
          </Link>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">
          Keys: <Kbd>H</Kbd> <Kbd>S</Kbd> <Kbd>D</Kbd> <Kbd>P</Kbd> <Kbd>R</Kbd> actions · <Kbd>1</Kbd>–<Kbd>4</Kbd> chips · <Kbd>⌫</Kbd> clear ·{" "}
          <Kbd>Enter</Kbd> deal / skip
        </p>
      </aside>
    </div>
  );
}

const GRID_COLS = ["grid-cols-1", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"];

function Felt({ view, rules, instant }: { view: TableView | null; rules: TableRules; instant: boolean }) {
  const seats = view ? [...view.seats].reverse() : []; // first base on the right, as seen from the players
  const n = seats.length;
  const center = (n - 1) / 2;
  return (
    <div data-instant={instant} className="felt relative overflow-hidden rounded-[1.25rem] px-2 pt-4 pb-4 sm:rounded-b-[45%_30%] sm:px-6 sm:pt-5 sm:pb-10">
      <div className="grid grid-cols-[auto_1fr_auto] items-start gap-2">
        {view ? <TrayGraphic shoe={view.shoe} seed={view.shoe.shoeNumber} /> : <div />}
        {view ? <DealerSpot dealer={view.dealer} /> : <div className="h-32" />}
        {view ? <ShoeGraphic shoe={view.shoe} /> : <div />}
      </div>

      <div className="pointer-events-none my-2 text-center text-[9px] tracking-[0.22em] text-amber-100/35 uppercase sm:my-3 sm:text-[11px]">
        {view && (
          <>
            Blackjack pays {rules.blackjackPayout === "3:2" ? "3 to 2" : "6 to 5"} · Dealer {rules.dealerHitsSoft17 ? "hits" : "stands on"} soft 17
          </>
        )}
      </div>

      <div className="min-h-6 text-center" aria-live="polite">
        {view && <Notices view={view} />}
      </div>

      <div className={cn("mt-2 grid gap-x-1 gap-y-4 sm:mt-4 sm:flex sm:items-start sm:justify-center sm:gap-4", GRID_COLS[Math.min(n, 4)])}>
        {seats.map((seat, i) => {
          const arc = n > 1 ? 1 - ((i - center) / center) ** 2 : 1;
          const active = view!.turn && view!.turn.seat === seat.id ? view!.turn.hand : null;
          return (
            <div key={seat.id} className="flex justify-center sm:[padding-top:var(--arc)]" style={{ ["--arc" as string]: `${arc * 2.2}rem` }}>
              <SeatSpot seat={seat} activeHand={active} human={seat.kind === "human"} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Notices({ view }: { view: TableView }) {
  const items: { icon: React.ReactNode; text: string; tone?: "warn" }[] = [];
  if (view.shuffles.includes("cut-card") || view.shuffles.includes("new-shoe"))
    items.push({ icon: <Shuffle className="size-3.5" />, text: `New shoe shuffled (shoe ${view.shoe.shoeNumber})` });
  if (view.shuffles.includes("insufficient-cards"))
    items.push({ icon: <Shuffle className="size-3.5" />, text: "Too few cards left for a full round: new shoe shuffled" });
  if (view.shuffles.includes("exhausted"))
    items.push({ icon: <AlertTriangle className="size-3.5" />, text: "The shoe ran out mid-round. Discards were reshuffled to finish; this shoe's count is invalid.", tone: "warn" });
  if (view.shoe.cutCardOut && !view.shoe.interrupted) items.push({ icon: <Info className="size-3.5" />, text: "Cut card is out: last round of this shoe" });
  if (view.peekedNoBlackjack && view.phase !== "roundOver") items.push({ icon: <Info className="size-3.5" />, text: "Dealer checked: no blackjack" });
  if (view.phase === "idle") items.push({ icon: <Info className="size-3.5" />, text: "Place your bet and deal" });
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {items.map((it, i) => (
        <span
          key={i}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs",
            it.tone === "warn" ? "bg-amber-500/90 text-black" : "bg-black/35 text-amber-50/85",
          )}
        >
          {it.icon}
          {it.text}
        </span>
      ))}
    </div>
  );
}
