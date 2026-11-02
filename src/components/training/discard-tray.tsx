import { seededRng } from "@/lib/blackjack/rng";

/**
 * Side view of a discard tray. Stack height is proportional to cards dealt at
 * a constant physical scale for a given shoe size, so the user has to judge
 * thickness rather than read a number. Optional deck guide lines.
 */
export function DiscardTray({
  decks,
  cardsDealt,
  seed,
  guides,
  perDeck: perDeckOverride,
  className = "h-auto w-full max-w-[220px]",
}: {
  decks: number;
  cardsDealt: number;
  seed: number;
  guides: boolean;
  /** Pixels (viewBox units) per deck. Defaults to one scale for shoes and a zoomed one for pitch games. */
  perDeck?: number;
  className?: string;
}) {
  const perDeck = perDeckOverride ?? (decks <= 2 ? 90 : 34);
  const capacity = decks * perDeck;
  const W = 150;
  const pad = 10;
  const H = capacity + pad * 2;
  const stack = (cardsDealt / 52) * perDeck;
  const rng = seededRng(seed);

  // Slightly irregular edges every ~6 cards so the stack reads as real cards.
  const slabs: { y: number; h: number; dx: number; shade: number }[] = [];
  let y = H - pad;
  let remaining = stack;
  while (remaining > 0) {
    const h = Math.min(remaining, (6 / 52) * perDeck);
    y -= h;
    slabs.push({ y, h, dx: (rng() - 0.5) * 3, shade: 0.85 + rng() * 0.15 });
    remaining -= h;
  }

  return (
    <svg viewBox={`0 0 ${W + 40} ${H}`} className={className} role="img" aria-label="Discard tray">
      <defs>
        <pattern id="card-edges" width="4" height="1.3" patternUnits="userSpaceOnUse">
          <rect width="4" height="1.3" fill="#f5f5f0" />
          <rect y="1" width="4" height="0.3" fill="#a8a29e" />
        </pattern>
      </defs>
      {/* tray */}
      <rect x={20} y={pad - 4} width={W} height={capacity + 8} rx={4} fill="oklch(0.2 0.01 60 / 60%)" stroke="oklch(0.8 0.115 85 / 45%)" strokeWidth={1.5} />
      {guides &&
        Array.from({ length: decks - 1 }, (_, i) => {
          const gy = H - pad - (i + 1) * perDeck;
          return (
            <g key={i}>
              <line x1={14} x2={20} y1={gy} y2={gy} stroke="oklch(0.8 0.115 85 / 70%)" />
              <text x={10} y={gy} fontSize={8} fill="oklch(0.8 0.115 85 / 80%)" textAnchor="middle" dominantBaseline="central">
                {i + 1}
              </text>
            </g>
          );
        })}
      {slabs.map((s, i) => (
        <rect key={i} x={26 + s.dx} y={s.y} width={W - 12} height={s.h} fill="url(#card-edges)" opacity={s.shade} />
      ))}
      {stack > 0 && <rect x={26} y={H - pad - stack} width={W - 12} height={1.2} fill="#7f1d1d" opacity={0.6} />}
    </svg>
  );
}
