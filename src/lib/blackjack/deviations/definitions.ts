/**
 * Hi-Lo index plays covered by the trainer: the Illustrious 18 and the Fab 4
 * surrender plays, as listed by Wizard of Odds
 * (https://wizardofodds.com/games/blackjack/card-counting/high-low/).
 *
 * The published values are six-deck numbers. They are kept here only to
 * validate this app's index generator; the indices actually used are computed
 * per ruleset (see analysis/index-gen.ts) and gated by validation status.
 */
import type { PointRank } from "../cards";

export type DeviationAction = "hit" | "stand" | "double" | "split" | "surrender" | "insure" | "decline";

export type CellHand = { readonly kind: "hard"; readonly total: number } | { readonly kind: "pair"; readonly rank: PointRank };

export interface PublishedIndex {
  readonly group: "I18" | "Fab4";
  /** Position in the published list, which is ordered by value. */
  readonly rank: number;
  /** Play `above` when TC ≥ index, otherwise `below`. */
  readonly index: number;
  readonly above: DeviationAction;
  readonly below: DeviationAction;
}

export interface DeviationCell {
  readonly id: string;
  readonly label: string;
  readonly kind: "play" | "insurance";
  readonly hand?: CellHand;
  readonly up: PointRank;
  /** Actions that compete in this cell (surrender only where the rules allow it). */
  readonly actions: readonly DeviationAction[];
  readonly published: readonly PublishedIndex[];
}

const stiff = ["hit", "stand", "surrender"] as const;
const dbl = ["hit", "double"] as const;

export const DEVIATION_CELLS: readonly DeviationCell[] = [
  { id: "insurance", label: "Insurance", kind: "insurance", up: 1, actions: ["insure", "decline"], published: [{ group: "I18", rank: 1, index: 3, above: "insure", below: "decline" }] },
  { id: "h16v10", label: "16 v 10", kind: "play", hand: { kind: "hard", total: 16 }, up: 10, actions: stiff, published: [{ group: "I18", rank: 2, index: 0, above: "stand", below: "hit" }] },
  {
    id: "h15v10",
    label: "15 v 10",
    kind: "play",
    hand: { kind: "hard", total: 15 },
    up: 10,
    actions: stiff,
    published: [
      { group: "I18", rank: 3, index: 4, above: "stand", below: "hit" },
      { group: "Fab4", rank: 2, index: 0, above: "surrender", below: "hit" },
    ],
  },
  { id: "p10v5", label: "10,10 v 5", kind: "play", hand: { kind: "pair", rank: 10 }, up: 5, actions: ["stand", "split"], published: [{ group: "I18", rank: 4, index: 5, above: "split", below: "stand" }] },
  { id: "p10v6", label: "10,10 v 6", kind: "play", hand: { kind: "pair", rank: 10 }, up: 6, actions: ["stand", "split"], published: [{ group: "I18", rank: 5, index: 4, above: "split", below: "stand" }] },
  { id: "h10v10", label: "10 v 10", kind: "play", hand: { kind: "hard", total: 10 }, up: 10, actions: dbl, published: [{ group: "I18", rank: 6, index: 4, above: "double", below: "hit" }] },
  { id: "h12v3", label: "12 v 3", kind: "play", hand: { kind: "hard", total: 12 }, up: 3, actions: ["hit", "stand"], published: [{ group: "I18", rank: 7, index: 2, above: "stand", below: "hit" }] },
  { id: "h12v2", label: "12 v 2", kind: "play", hand: { kind: "hard", total: 12 }, up: 2, actions: ["hit", "stand"], published: [{ group: "I18", rank: 8, index: 3, above: "stand", below: "hit" }] },
  { id: "h11v1", label: "11 v A", kind: "play", hand: { kind: "hard", total: 11 }, up: 1, actions: dbl, published: [{ group: "I18", rank: 9, index: 1, above: "double", below: "hit" }] },
  { id: "h9v2", label: "9 v 2", kind: "play", hand: { kind: "hard", total: 9 }, up: 2, actions: dbl, published: [{ group: "I18", rank: 10, index: 1, above: "double", below: "hit" }] },
  { id: "h10v1", label: "10 v A", kind: "play", hand: { kind: "hard", total: 10 }, up: 1, actions: dbl, published: [{ group: "I18", rank: 11, index: 4, above: "double", below: "hit" }] },
  { id: "h9v7", label: "9 v 7", kind: "play", hand: { kind: "hard", total: 9 }, up: 7, actions: dbl, published: [{ group: "I18", rank: 12, index: 3, above: "double", below: "hit" }] },
  { id: "h16v9", label: "16 v 9", kind: "play", hand: { kind: "hard", total: 16 }, up: 9, actions: stiff, published: [{ group: "I18", rank: 13, index: 5, above: "stand", below: "hit" }] },
  { id: "h13v2", label: "13 v 2", kind: "play", hand: { kind: "hard", total: 13 }, up: 2, actions: ["hit", "stand"], published: [{ group: "I18", rank: 14, index: -1, above: "stand", below: "hit" }] },
  { id: "h12v4", label: "12 v 4", kind: "play", hand: { kind: "hard", total: 12 }, up: 4, actions: ["hit", "stand"], published: [{ group: "I18", rank: 15, index: 0, above: "stand", below: "hit" }] },
  { id: "h12v5", label: "12 v 5", kind: "play", hand: { kind: "hard", total: 12 }, up: 5, actions: ["hit", "stand"], published: [{ group: "I18", rank: 16, index: -2, above: "stand", below: "hit" }] },
  { id: "h12v6", label: "12 v 6", kind: "play", hand: { kind: "hard", total: 12 }, up: 6, actions: ["hit", "stand"], published: [{ group: "I18", rank: 17, index: -1, above: "stand", below: "hit" }] },
  { id: "h13v3", label: "13 v 3", kind: "play", hand: { kind: "hard", total: 13 }, up: 3, actions: ["hit", "stand"], published: [{ group: "I18", rank: 18, index: -2, above: "stand", below: "hit" }] },
  { id: "h14v10", label: "14 v 10", kind: "play", hand: { kind: "hard", total: 14 }, up: 10, actions: stiff, published: [{ group: "Fab4", rank: 1, index: 3, above: "surrender", below: "hit" }] },
  { id: "h15v9", label: "15 v 9", kind: "play", hand: { kind: "hard", total: 15 }, up: 9, actions: stiff, published: [{ group: "Fab4", rank: 3, index: 2, above: "surrender", below: "hit" }] },
  { id: "h15v1", label: "15 v A", kind: "play", hand: { kind: "hard", total: 15 }, up: 1, actions: stiff, published: [{ group: "Fab4", rank: 4, index: 1, above: "surrender", below: "hit" }] },
];

export const CELL_BY_ID: ReadonlyMap<string, DeviationCell> = new Map(DEVIATION_CELLS.map((c) => [c.id, c]));

/** Cells among the six most valuable published plays (published list order). */
export function isTopValue(cell: DeviationCell): boolean {
  return cell.published.some((p) => p.group === "I18" && p.rank <= 6) || cell.published.some((p) => p.group === "Fab4" && p.rank <= 2);
}
