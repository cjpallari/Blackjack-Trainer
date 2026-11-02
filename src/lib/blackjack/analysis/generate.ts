import { POINT_RANKS, type PointRank } from "../cards";
import { strategyTableId, type ActionEVs, type StrategyTable } from "../strategy-table";
import { fullShoeCounts, UpcardAnalyzer, type AnalysisRules } from "./ca";

export const ANALYSIS_METHOD =
  "Exact finite-shoe combinatorial analysis (dealer peeks; hole card modelled explicitly). " +
  "Hard and soft cells are probability-weighted averages over two-card compositions of that total; " +
  "splits are computed without resplitting, split aces receive one card.";

type MutableRow = Record<string, ActionEVs>;

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function roundEVs(e: ActionEVs): ActionEVs {
  const out: { -readonly [K in keyof ActionEVs]: ActionEVs[K] } = {
    stand: round(e.stand),
    hit: round(e.hit),
    double: round(e.double),
  };
  if (e.splitDAS !== undefined) out.splitDAS = round(e.splitDAS);
  if (e.splitNoDAS !== undefined) out.splitNoDAS = round(e.splitNoDAS);
  return out;
}

export function generateStrategyTable(rules: AnalysisRules): StrategyTable {
  const hard: Record<string, MutableRow> = {};
  const soft: Record<string, MutableRow> = {};
  const pairs: Record<string, MutableRow> = {};
  const full = fullShoeCounts(rules.decks);

  for (const up of POINT_RANKS) {
    const comp = Int32Array.from(full);
    comp[up]--;
    const main = new UpcardAnalyzer(comp, up, rules.dealerHitsSoft17);

    // Hard totals from non-pair, ace-free two-card hands, probability weighted.
    const acc = new Map<number, { w: number; stand: number; hit: number; double: number }>();
    for (let i = 2; i <= 10; i++) {
      for (let j = i + 1; j <= 10; j++) {
        const w = 2 * comp[i] * comp[j];
        if (w === 0) continue;
        const e = main.handEVs([i as PointRank, j as PointRank]);
        const t = i + j;
        const a = acc.get(t) ?? { w: 0, stand: 0, hit: 0, double: 0 };
        a.w += w;
        a.stand += w * e.stand;
        a.hit += w * e.hit;
        a.double += w * e.double;
        acc.set(t, a);
      }
    }
    for (const [t, a] of acc) {
      (hard[t] ??= {})[up] = roundEVs({ stand: a.stand / a.w, hit: a.hit / a.w, double: a.double / a.w });
    }
    (hard[4] ??= {})[up] = roundEVs(main.handEVs([2, 2]));
    (hard[20] ??= {})[up] = roundEVs(main.handEVs([10, 10]));

    for (let x = 1; x <= 9; x++) {
      const total = x === 1 ? 12 : 11 + x;
      (soft[total] ??= {})[up] = roundEVs(main.handEVs([1, x as PointRank]));
    }

    for (const x of POINT_RANKS) {
      if (comp[x] < 2) continue;
      const base = main.handEVs([x, x]);
      const splitComp = Int32Array.from(comp);
      splitComp[x]--;
      const split = new UpcardAnalyzer(splitComp, up, rules.dealerHitsSoft17).splitEVs(x);
      (pairs[x] ??= {})[up] = roundEVs({ ...base, ...split });
    }
  }

  return {
    id: strategyTableId(rules.decks, rules.dealerHitsSoft17),
    decks: rules.decks,
    dealerHitsSoft17: rules.dealerHitsSoft17,
    method: ANALYSIS_METHOD,
    hard,
    soft,
    pairs,
  };
}
