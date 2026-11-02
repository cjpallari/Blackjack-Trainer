import { cn } from "@/lib/utils";
import { isRed, SUIT_SYMBOL, type Card } from "@/lib/blackjack/cards";

/** Pip positions on a 100×140 card face, per standard layouts. */
const L = 30;
const C = 50;
const R = 70;
const PIPS: Record<string, [number, number][]> = {
  "2": [[C, 28], [C, 112]],
  "3": [[C, 28], [C, 70], [C, 112]],
  "4": [[L, 28], [R, 28], [L, 112], [R, 112]],
  "5": [[L, 28], [R, 28], [C, 70], [L, 112], [R, 112]],
  "6": [[L, 28], [R, 28], [L, 70], [R, 70], [L, 112], [R, 112]],
  "7": [[L, 28], [R, 28], [C, 49], [L, 70], [R, 70], [L, 112], [R, 112]],
  "8": [[L, 28], [R, 28], [C, 49], [L, 70], [R, 70], [C, 91], [L, 112], [R, 112]],
  "9": [[L, 28], [R, 28], [L, 56], [R, 56], [C, 70], [L, 84], [R, 84], [L, 112], [R, 112]],
  "10": [[L, 28], [R, 28], [C, 42], [L, 56], [R, 56], [L, 84], [R, 84], [C, 98], [L, 112], [R, 112]],
};

const SIZES = {
  xs: "w-9",
  sm: "w-12",
  md: "w-16 sm:w-20",
  lg: "w-20 sm:w-24",
} as const;

export type CardSize = keyof typeof SIZES;

export function PlayingCard({
  card,
  faceDown = false,
  size = "md",
  className,
}: {
  card?: Pick<Card, "rank" | "suit">;
  faceDown?: boolean;
  size?: CardSize;
  className?: string;
}) {
  const wrap = cn("relative aspect-[5/7] shrink-0 select-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)]", SIZES[size], className);

  if (faceDown || !card) {
    return (
      <svg viewBox="0 0 100 140" className={wrap} role="img" aria-label="Face-down card">
        <defs>
          <pattern id="card-back" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="#7f1d1d" />
            <rect width="5" height="10" fill="#991b1b" />
          </pattern>
        </defs>
        <rect x="1" y="1" width="98" height="138" rx="7" fill="#fafafa" stroke="#d4d4d4" />
        <rect x="7" y="7" width="86" height="126" rx="4" fill="url(#card-back)" stroke="#c9a227" strokeWidth="1.5" />
      </svg>
    );
  }

  const red = isRed(card.suit);
  const color = red ? "#c81e1e" : "#111827";
  const sym = SUIT_SYMBOL[card.suit];
  const face = card.rank === "J" || card.rank === "Q" || card.rank === "K";
  const label = `${card.rank} of ${card.suit}`;

  return (
    <svg viewBox="0 0 100 140" className={wrap} role="img" aria-label={label}>
      <rect x="1" y="1" width="98" height="138" rx="7" fill="#fdfdfb" stroke="#d6d3d1" />
      <g fill={color} fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">
        <Index rank={card.rank} sym={sym} />
        <g transform="rotate(180 50 70)">
          <Index rank={card.rank} sym={sym} />
        </g>
        {card.rank === "A" && (
          <text x="50" y="70" fontSize="48" textAnchor="middle" dominantBaseline="central">
            {sym}
          </text>
        )}
        {face && (
          <>
            <rect x="22" y="24" width="56" height="92" rx="4" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" />
            <text x="50" y="62" fontSize="34" textAnchor="middle" dominantBaseline="central">
              {card.rank}
            </text>
            <text x="50" y="92" fontSize="24" textAnchor="middle" dominantBaseline="central">
              {sym}
            </text>
          </>
        )}
        {PIPS[card.rank]?.map(([x, y], i) => (
          <text
            key={i}
            x={x}
            y={y}
            fontSize="19"
            textAnchor="middle"
            dominantBaseline="central"
            transform={y > 70 ? `rotate(180 ${x} ${y})` : undefined}
          >
            {sym}
          </text>
        ))}
      </g>
    </svg>
  );
}

function Index({ rank, sym }: { rank: string; sym: string }) {
  return (
    <>
      <text x="10" y="17" fontSize={rank === "10" ? 14 : 16} textAnchor="middle" letterSpacing={rank === "10" ? -1.5 : 0}>
        {rank}
      </text>
      <text x="10" y="31" fontSize="12" textAnchor="middle">
        {sym}
      </text>
    </>
  );
}

/** Cards overlapped horizontally, as on a table. */
export function CardRow({
  cards,
  hideIndex,
  size = "md",
  className,
}: {
  cards: readonly Pick<Card, "rank" | "suit">[];
  /** Index of a face-down card (e.g. the dealer's hole card). */
  hideIndex?: number;
  size?: CardSize;
  className?: string;
}) {
  return (
    <div className={cn("flex", className)}>
      {cards.map((c, i) => (
        <div key={i} className={cn(i > 0 && "-ml-8 sm:-ml-10", size === "sm" && i > 0 && "-ml-6 sm:-ml-6", size === "xs" && i > 0 && "-ml-5 sm:-ml-5")}>
          <PlayingCard card={c} faceDown={i === hideIndex} size={size} />
        </div>
      ))}
    </div>
  );
}
