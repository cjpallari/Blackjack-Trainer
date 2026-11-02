import type { PointRank } from "./cards";
import { handValueFromRanks } from "./hand";
import type { TableRules } from "./rules";
import { strategyTableId, type ActionEVs, type StrategyTable } from "./strategy-table";
import t1S from "./strategy-data/1D-S17.json";
import t1H from "./strategy-data/1D-H17.json";
import t2S from "./strategy-data/2D-S17.json";
import t2H from "./strategy-data/2D-H17.json";
import t4S from "./strategy-data/4D-S17.json";
import t4H from "./strategy-data/4D-H17.json";
import t6S from "./strategy-data/6D-S17.json";
import t6H from "./strategy-data/6D-H17.json";
import t8S from "./strategy-data/8D-S17.json";
import t8H from "./strategy-data/8D-H17.json";

export type PlayerAction = "hit" | "stand" | "double" | "split" | "surrender";
export const ALL_ACTIONS: readonly PlayerAction[] = ["hit", "stand", "double", "split", "surrender"];

/**
 * Actions whose EVs differ by less than this (per unit bet) are treated as
 * equivalent. The tables are rounded to 1e-6, so this only absorbs genuine
 * ties and rounding noise; it does not excuse close-but-real differences.
 */
export const TIE_EPSILON = 5e-5;

const TABLES: Record<string, StrategyTable> = Object.fromEntries(
  [t1S, t1H, t2S, t2H, t4S, t4H, t6S, t6H, t8S, t8H].map((t) => [t.id, t as StrategyTable]),
);

export function strategyTableFor(rules: Pick<TableRules, "decks" | "dealerHitsSoft17" | "variant">): StrategyTable {
  if (rules.variant !== "standard") throw new Error(`No verified strategy for variant ${rules.variant}`);
  const t = TABLES[strategyTableId(rules.decks, rules.dealerHitsSoft17)];
  if (!t) throw new Error(`No strategy table for ${rules.decks} decks`);
  return t;
}

export type HandCategory = "hard" | "soft" | "pair";

export interface DecisionInput {
  readonly cards: readonly PointRank[];
  readonly up: PointRank;
  /** Actions legally available right now. */
  readonly available: readonly PlayerAction[];
}

export interface StrategyAdvice {
  readonly best: PlayerAction;
  /** All actions within TIE_EPSILON of the best (always includes `best`). */
  readonly acceptable: readonly PlayerAction[];
  readonly evs: Readonly<Partial<Record<PlayerAction, number>>>;
  readonly category: HandCategory;
  readonly total: number;
  /** Key of the table row used, e.g. "hard 16", "soft 18", "pair 8". */
  readonly row: string;
}

function lookupCell(
  table: StrategyTable,
  cards: readonly PointRank[],
  up: PointRank,
  canSplit: boolean,
): { cell: ActionEVs; category: HandCategory; total: number; row: string } {
  const v = handValueFromRanks(cards);
  const u = String(up);
  if (canSplit && cards.length === 2 && cards[0] === cards[1]) {
    const r = cards[0];
    return { cell: table.pairs[r][u], category: "pair", total: v.total, row: `pair ${r === 1 ? "A" : r}` };
  }
  if (v.soft && v.total <= 20) {
    return { cell: table.soft[v.total][u], category: "soft", total: v.total, row: `soft ${v.total}` };
  }
  // Hard 21 / soft 21: always stand (EVs not needed; represent with a stand-dominant cell).
  if (v.total >= 21) {
    return { cell: { stand: 1, hit: -1, double: -2 }, category: v.soft ? "soft" : "hard", total: v.total, row: `${v.soft ? "soft" : "hard"} 21` };
  }
  const t = Math.max(4, v.total);
  return { cell: table.hard[t][u], category: "hard", total: v.total, row: `hard ${t}` };
}

export function evaluateDecision(
  table: StrategyTable,
  rules: Pick<TableRules, "doubleAfterSplit">,
  input: DecisionInput,
): StrategyAdvice {
  const avail = new Set(input.available);
  const { cell, category, total, row } = lookupCell(table, input.cards, input.up, avail.has("split"));
  const evs: Partial<Record<PlayerAction, number>> = {};
  if (avail.has("stand")) evs.stand = cell.stand;
  if (avail.has("hit")) evs.hit = cell.hit;
  if (avail.has("double")) evs.double = cell.double;
  if (avail.has("surrender")) evs.surrender = -0.5;
  if (avail.has("split") && category === "pair") {
    const s = rules.doubleAfterSplit ? cell.splitDAS : cell.splitNoDAS;
    if (s !== undefined) evs.split = s;
  }
  let best: PlayerAction | undefined;
  let bestEv = -Infinity;
  for (const a of ALL_ACTIONS) {
    const e = evs[a];
    if (e !== undefined && e > bestEv) {
      bestEv = e;
      best = a;
    }
  }
  if (!best) throw new Error("No actions available");
  const acceptable = ALL_ACTIONS.filter((a) => evs[a] !== undefined && bestEv - (evs[a] as number) < TIE_EPSILON);
  return { best, acceptable, evs, category, total, row };
}

/**
 * Compact chart code for a cell under a ruleset, as printed on strategy cards:
 * H, S, D (double else hit), Ds (double else stand), P, R (surrender else hit),
 * Rs (surrender else stand), Rp (surrender else split).
 */
export function chartCode(
  cell: ActionEVs,
  rules: Pick<TableRules, "doubleAfterSplit" | "surrender">,
  isPairCell: boolean,
): string {
  const noDouble = cell.hit >= cell.stand ? "H" : "S";
  const split = isPairCell ? (rules.doubleAfterSplit ? cell.splitDAS : cell.splitNoDAS) : undefined;
  const nonSurrender = (): string => {
    const opts: [string, number][] = [
      ["H", cell.hit],
      ["S", cell.stand],
      [noDouble === "H" ? "D" : "Ds", cell.double],
    ];
    if (split !== undefined) opts.push(["P", split]);
    opts.sort((a, b) => b[1] - a[1]);
    return opts[0][0];
  };
  const base = nonSurrender();
  if (rules.surrender === "late") {
    const baseEv = Math.max(cell.hit, cell.stand, cell.double, split ?? -Infinity);
    if (-0.5 > baseEv) return base === "P" ? "Rp" : base === "S" ? "Rs" : "R";
  }
  return base;
}
