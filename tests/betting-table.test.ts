import { describe, expect, it } from "vitest";
import { basicStrategyAction } from "@/lib/blackjack/engine";
import { seededRng } from "@/lib/blackjack/rng";
import { DEFAULT_RULES } from "@/lib/blackjack/rules";
import { buildTableView } from "@/lib/blackjack/table-view";
import { preBetFromView } from "@/lib/betting/observe";
import { RAMP_PRESETS } from "@/lib/betting/ramp";
import { preBetObservation } from "@/lib/sim/simulate";
import { DEFAULT_CHECKPOINTS } from "@/lib/training/table/count-checks";
import { aggregateHistory } from "@/lib/training/table/history";
import { assistanceFor, DEFAULT_INTERMEDIATE } from "@/lib/training/table/modes";
import { createTrainingTable, skipCheck, submitCheck, trainingAct, trainingDeal, trainingInsurance, type TrainingOptions, type TrainingTable } from "@/lib/training/table/training-table";

const ramp = RAMP_PRESETS.find((r) => r.id === "1-8")!;
const OPTS: TrainingOptions = {
  mode: "intermediate",
  intermediate: DEFAULT_INTERMEDIATE,
  checkpoints: { ...DEFAULT_CHECKPOINTS, every: 0, endOfShoe: false },
  rounding: "truncate",
  keepDecisionDetail: true,
  deviations: true,
  betting: { ramp: { ...ramp, unit: 10 }, limits: { tableMin: 10, tableMax: 500, chip: 5 } },
};

function playRound(t: TrainingTable, bet: number, r: ReturnType<typeof seededRng>): TrainingTable {
  t = trainingDeal(t, bet, OPTS, r, 1);
  if (t.session.state.phase === "insurance") t = trainingInsurance(t, 0, OPTS, r, 1);
  while (t.session.state.phase === "playerTurn") t = trainingAct(t, basicStrategyAction(t.session.state), OPTS, r, 1);
  if (t.pending) t = t.pending.kind === "end-of-shoe" ? submitCheck(t, { runningCount: 0 }, OPTS, 1) : skipCheck(t, OPTS, 1);
  return t;
}

describe("betting training at the table", () => {
  it("the view-based observation always equals the engine-state observation", () => {
    const r = seededRng(3);
    let t = createTrainingTable({ rules: { ...DEFAULT_RULES, aiPlayers: 2 }, humanSeat: 1, bankroll: 1e6 }, OPTS, r, 1);
    let shuffles = 0;
    for (let i = 0; i < 120; i++) {
      const s = t.session.state;
      const bankroll = s.seats[t.session.humanSeatId].bankroll;
      expect(preBetFromView(buildTableView(s), bankroll)).toEqual(preBetObservation(s, bankroll));
      if (s.reshufflePending) shuffles++;
      t = playRound(t, 10, r);
    }
    expect(shuffles).toBeGreaterThan(5); // covered the fresh-shoe case repeatedly
  });

  it("grades wagers against the ramp without counting them as playing mistakes", () => {
    const r = seededRng(4);
    let t = createTrainingTable({ rules: { ...DEFAULT_RULES, aiPlayers: 1 }, humanSeat: 0, bankroll: 1e6 }, OPTS, r, 1);
    // First round of a fresh shoe: TC 0 → 1 unit = $10.
    t = playRound(t, 10, r);
    expect(t.lastBet).toMatchObject({ trueCount: 0, recommended: 10, chosen: 10, correct: true });
    t = playRound(t, 100, r);
    expect(t.lastBet!.chosen).toBe(100);
    expect(t.tracker.bets).toHaveLength(2);
    const wrongBets = t.tracker.bets.filter((b) => !b.correct).length;
    // Playing decisions were basic-strategy correct regardless of the bet size.
    expect(t.tracker.decisions.every((d) => d.correct !== false || d.deviation)).toBe(true);
    expect(wrongBets).toBeLessThanOrEqual(1);
  });

  it("shoe reports and history summarise betting accuracy separately", () => {
    const r = seededRng(5);
    let t = createTrainingTable({ rules: { ...DEFAULT_RULES, aiPlayers: 2 }, humanSeat: 1, bankroll: 1e6 }, OPTS, r, 1);
    for (let i = 0; i < 40 && !t.completedReport; i++) t = playRound(t, 10, r);
    const rep = t.completedReport!;
    expect(rep.betting!.decisions).toBe(rep.shoe.rounds);
    expect(rep.betting!.correct).toBeLessThanOrEqual(rep.betting!.decisions);
    expect(rep.betting!.misses.every((m) => m.chosen === 10 && m.recommended !== 10)).toBe(true);
    const agg = aggregateHistory([rep]);
    expect(agg.betDecisions).toBe(rep.betting!.decisions);
    expect(agg.betCorrect).toBe(rep.betting!.correct);
  });

  it("Casino Mode shows no betting hint and defers betting feedback; Beginner shows the hint", () => {
    expect(assistanceFor("casino", DEFAULT_INTERMEDIATE)).toMatchObject({ betHint: false, betFeedback: "deferred" });
    expect(assistanceFor("intermediate", DEFAULT_INTERMEDIATE)).toMatchObject({ betHint: false, betFeedback: "immediate" });
    expect(assistanceFor("beginner", DEFAULT_INTERMEDIATE)).toMatchObject({ betHint: true, betFeedback: "immediate" });
  });

  it("betting training off records no wagers", () => {
    const r = seededRng(6);
    const off = { ...OPTS, betting: null };
    let t = createTrainingTable({ rules: { ...DEFAULT_RULES, aiPlayers: 0 }, humanSeat: 0, bankroll: 1e6 }, off, r, 1);
    t = trainingDeal(t, 10, off, r, 1);
    expect(t.tracker.bets).toHaveLength(0);
    expect(t.lastBet).toBeNull();
  });
});
