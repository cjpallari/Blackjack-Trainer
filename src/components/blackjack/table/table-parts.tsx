import { PlayingCard } from "@/components/blackjack/playing-card";
import { DiscardTray } from "@/components/training/discard-tray";
import type { HandOutcome } from "@/lib/blackjack/engine";
import type { CardView, DealerView, HandView, SeatView, ShoeView } from "@/lib/blackjack/table-view";
import { cn } from "@/lib/utils";

/**
 * Table pieces size themselves in `em`, so a container's font-size scales a
 * whole seat (cards, chips, labels) consistently at every breakpoint.
 */

function TableCard({ card, index }: { card: CardView; index: number }) {
  return (
    <div className="animate-in fade-in slide-in-from-top-2 duration-200 in-data-[instant=true]:animate-none" style={{ marginLeft: index ? "-2.35em" : 0, marginTop: `${index * -0.35}em` }}>
      {card.faceDown ? <PlayingCard faceDown className="w-[3.6em]" /> : <PlayingCard card={card} className="w-[3.6em]" />}
    </div>
  );
}

const OUTCOME: Record<HandOutcome, { label: string; cls: string }> = {
  blackjack: { label: "Blackjack", cls: "bg-success text-black" },
  win: { label: "Win", cls: "bg-success text-black" },
  push: { label: "Push", cls: "bg-zinc-300 text-black" },
  lose: { label: "Lose", cls: "bg-destructive text-white" },
  bust: { label: "Bust", cls: "bg-destructive text-white" },
  surrender: { label: "Surrender", cls: "bg-zinc-500 text-white" },
};

function totalLabel(h: HandView): string | null {
  if (!h.value) return null;
  if (h.blackjack) return "BJ";
  if (h.value.busted) return `${h.value.total}`;
  return h.value.soft && h.value.total < 21 ? `${h.value.total - 10}/${h.value.total}` : `${h.value.total}`;
}

export function Chip({ amount, className }: { amount: number; className?: string }) {
  const color = amount >= 500 ? "bg-violet-700" : amount >= 100 ? "bg-sky-800" : amount >= 25 ? "bg-emerald-700" : "bg-red-700";
  return (
    <span
      className={cn(
        "tabular inline-grid size-[2.2em] place-items-center rounded-full border-[0.18em] border-dashed border-white/80 text-[0.7em] font-bold text-white shadow-md ring-1 ring-black/40",
        color,
        className,
      )}
    >
      {amount >= 1000 ? `${amount / 1000}k` : amount}
    </span>
  );
}

export function HandStack({ hand, active }: { hand: HandView; active: boolean }) {
  const total = totalLabel(hand);
  const o = hand.outcome ? OUTCOME[hand.outcome] : null;
  return (
    <div className="flex flex-col items-center gap-[0.35em]">
      <div className={cn("relative flex min-h-[5.4em] items-end rounded-[0.4em] p-[0.2em] transition-shadow", active && "ring-[0.12em] ring-primary shadow-[0_0_1.2em_oklch(0.8_0.115_85/45%)]")}>
        {hand.cards.map((c, i) => (
          <TableCard key={c.faceDown ? `down-${i}` : c.id} card={c} index={i} />
        ))}
        {total && (
          <span
            className={cn(
              "tabular absolute -top-[0.6em] -right-[0.6em] rounded-full px-[0.45em] text-[0.75em] leading-[1.5em] font-semibold shadow",
              hand.value?.busted ? "bg-destructive text-white" : "bg-black/75 text-amber-50",
            )}
          >
            {total}
          </span>
        )}
      </div>
      <div className="flex h-[1.6em] items-center gap-[0.3em]">
        <Chip amount={hand.bet} />
        {hand.doubled && <span className="text-[0.7em] font-semibold text-amber-200">×2</span>}
        {o && (
          <span className={cn("rounded px-[0.4em] text-[0.7em] leading-[1.5em] font-semibold whitespace-nowrap", o.cls)}>
            {o.label}
            {hand.net !== undefined && hand.net !== 0 && ` ${hand.net > 0 ? "+" : "−"}${Math.abs(hand.net)}`}
          </span>
        )}
      </div>
    </div>
  );
}

export function SeatSpot({ seat, activeHand, human }: { seat: SeatView; activeHand: number | null; human: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-[0.4em]", human ? "text-[13px] sm:text-[15px] lg:text-[17px]" : "text-[9px] sm:text-[11px] lg:text-[13px]")}>
      <div className="flex min-h-[7.5em] items-end justify-center gap-[0.8em]">
        {seat.hands.length === 0 ? (
          <div className="grid size-[3.4em] place-items-center rounded-full border border-dashed border-amber-100/25 text-[0.7em] text-amber-100/40">
            {seat.inRound ? "" : "—"}
          </div>
        ) : (
          seat.hands.map((h, i) => <HandStack key={i} hand={h} active={activeHand === i} />)
        )}
      </div>
      <div
        className={cn(
          "max-w-full truncate rounded-full px-[0.7em] text-[0.8em] leading-[1.7em]",
          human ? "bg-primary font-semibold text-primary-foreground" : "bg-black/30 text-amber-50/75",
        )}
      >
        {seat.name}
      </div>
      {seat.insurance && (
        <div className="tabular rounded bg-black/40 px-[0.5em] text-[0.7em] leading-[1.6em] text-amber-100">
          Insurance {seat.insurance.amount}
          {seat.insurance.net !== undefined && ` · ${seat.insurance.net > 0 ? "+" : "−"}${Math.abs(seat.insurance.net)}`}
        </div>
      )}
    </div>
  );
}

export function DealerSpot({ dealer }: { dealer: DealerView }) {
  const v = dealer.visibleValue;
  const label = !v ? "" : dealer.blackjack ? "Blackjack" : !dealer.holeRevealed && dealer.cards.length > 1 ? `Shows ${v.total}` : v.busted ? `Bust ${v.total}` : `${v.total}`;
  return (
    <div className="flex flex-col items-center gap-[0.5em] text-[11px] sm:text-[14px] lg:text-[16px]">
      <span className="text-[0.75em] tracking-[0.25em] text-amber-100/60 uppercase">Dealer</span>
      <div className="flex min-h-[5.4em] items-end">
        {dealer.cards.map((c, i) => (
          <TableCard key={c.faceDown ? `down-${i}` : c.id} card={c} index={i} />
        ))}
      </div>
      <span className="tabular h-[1.5em] rounded-full bg-black/35 px-[0.7em] text-[0.8em] leading-[1.5em] font-medium text-amber-50">{label}</span>
    </div>
  );
}

/** Shoe seen from above: remaining stack, with the cut card where it sits. */
export function ShoeGraphic({ shoe }: { shoe: ShoeView }) {
  const L = 100;
  const remainingW = (shoe.cardsInShoe / shoe.totalCards) * L;
  const dealtSoFar = shoe.totalCards - shoe.cardsInShoe;
  const cutFromFront = ((shoe.cutCardIndex - dealtSoFar) / shoe.totalCards) * L;
  return (
    <figure className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 130 44" className="w-20 sm:w-28" role="img" aria-label="Card shoe">
        <path d="M8 6 H124 V38 H2 Z" fill="oklch(0.18 0.01 60)" stroke="oklch(0.8 0.115 85 / 50%)" strokeWidth="1.2" />
        <rect x={12} y={11} width={Math.max(0, remainingW)} height={22} fill="url(#shoe-edges)" />
        {!shoe.cutCardOut && cutFromFront >= 0 && <rect x={12 + cutFromFront} y={9} width={1.8} height={26} fill="#dc2626" />}
        <defs>
          <pattern id="shoe-edges" width="1.3" height="4" patternUnits="userSpaceOnUse">
            <rect width="1.3" height="4" fill="#f5f5f0" />
            <rect x="1" width="0.3" height="4" fill="#a8a29e" />
          </pattern>
        </defs>
      </svg>
      <figcaption className="text-[10px] tracking-[0.2em] text-amber-50/50 uppercase">{shoe.cutCardOut ? "Cut card out" : "Shoe"}</figcaption>
    </figure>
  );
}

export function TrayGraphic({ shoe, seed }: { shoe: ShoeView; seed: number }) {
  return (
    <figure className="flex flex-col items-center gap-1">
      <DiscardTray
        decks={shoe.decks}
        cardsDealt={shoe.cardsInDiscard}
        seed={seed}
        guides={false}
        perDeck={shoe.decks <= 2 ? 30 : 11}
        className="h-auto w-14 sm:w-20"
      />
      <figcaption className="text-[10px] tracking-[0.2em] text-amber-50/50 uppercase">Discards</figcaption>
    </figure>
  );
}
