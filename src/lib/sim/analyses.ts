/**
 * Analyses built on SessionRunner: expected value, spread comparison, risk of
 * ruin and penetration sweeps. Pure and deterministic for a given seed; used
 * by the Web Worker and by Node scripts/tests.
 */
import { jobSeed } from "../blackjack/analysis/mc-validate";
import { seededRng } from "../blackjack/rng";
import { spreadOf, type BettingRamp } from "../betting/ramp";
import { emptyStats, SessionRunner, TC_BINS, type SessionStats, type SimConfig } from "./simulate";
import { distinguishable, meanSe, normalInterval, percentile, wilson, type Interval } from "./stats";

export type Progress = (done: number, total: number) => void;

const CHUNK = 5000;

export interface EvRequest {
  readonly sim: SimConfig;
  readonly rounds: number;
  readonly seed: number;
  /** Illustrative assumption used for hourly figures. */
  readonly roundsPerHour: number;
}

export interface BinSummary {
  readonly label: string;
  /** Share of betting opportunities (rounds observed) at this true count. */
  readonly opportunityShare: number;
  /** Share of all initial wagers placed at this true count. */
  readonly wagerShare: number;
  readonly roundsPlayed: number;
  /** Net ÷ initial wagers within the bin. */
  readonly edgeOnInitial: number | null;
}

export interface EvSummary {
  readonly seed: number;
  readonly roundsRequested: number;
  readonly roundsObserved: number;
  readonly roundsPlayed: number;
  readonly hands: number;
  readonly shoes: number;
  readonly invalidShoes: number;
  readonly invalidRounds: number;
  readonly initialWagered: number;
  readonly additionalWagered: number;
  readonly insuranceWagered: number;
  readonly totalWagered: number;
  readonly net: number;
  readonly insuranceNet: number;
  /** Net ÷ initial wagers, with a 95% interval (shoes as clusters). */
  readonly edgeOnInitial: Interval;
  /** Net ÷ all money wagered (initial + doubles + splits + insurance). */
  readonly returnOnTotal: Interval;
  /** Net per round observed, in chips. */
  readonly perRound: Interval;
  readonly per100: Interval;
  readonly perHour: Interval;
  readonly roundsPerHour: number;
  readonly avgInitialBet: number;
  /** Average total money at risk per round played (initial + doubles + splits + insurance). */
  readonly avgAtRisk: number;
  /** Observed standard deviation of one round's result (rounds treated individually). */
  readonly sdRound: number;
  /** SD of the result over 100 rounds, from shoe-level variance (accounts for within-shoe correlation). */
  readonly sdPer100: number;
  readonly bins: readonly BinSummary[];
  readonly deviationsApplied: number;
  readonly deviationFallbacks: number;
  readonly penetration: {
    readonly cutCardIndex: number;
    readonly cutFraction: number;
    readonly avgCardsDealtPerShoe: number | null;
    readonly avgDealtFraction: number | null;
    readonly roundsPerShoe: number | null;
    readonly reshufflesPer100Rounds: number;
  };
  readonly runtimeMs: number;
  readonly roundsPerSecond: number;
}

export function summarize(stats: SessionStats, sim: SimConfig, meta: { seed: number; rounds: number; roundsPerHour: number; runtimeMs: number }): EvSummary {
  const st = stats;
  const totalWagered = st.initialWagered + st.additionalWagered + st.insuranceWagered;
  const perRound = normalInterval(st.perRound.ratio, st.perRound.se);
  const scale = (i: Interval, k: number): Interval => ({ estimate: i.estimate * k, low: i.low * k, high: i.high * k });
  const mean = st.roundsPlayed ? st.net / st.roundsPlayed : NaN;
  const sdRound = st.roundsPlayed > 1 ? Math.sqrt(Math.max(0, st.sumSqRoundNet / st.roundsPlayed - mean * mean)) : NaN;
  const totalCards = sim.rules.decks * 52;
  const cut = Math.round(totalCards * sim.rules.penetration);
  return {
    seed: meta.seed,
    roundsRequested: meta.rounds,
    roundsObserved: st.roundsObserved,
    roundsPlayed: st.roundsPlayed,
    hands: st.hands,
    shoes: st.shoes,
    invalidShoes: st.invalidShoes,
    invalidRounds: st.invalidRounds,
    initialWagered: st.initialWagered,
    additionalWagered: st.additionalWagered,
    insuranceWagered: st.insuranceWagered,
    totalWagered,
    net: st.net,
    insuranceNet: st.insuranceNet,
    edgeOnInitial: normalInterval(st.perInitial.ratio, st.perInitial.se),
    returnOnTotal: normalInterval(st.perTotal.ratio, st.perTotal.se),
    perRound,
    per100: scale(perRound, 100),
    perHour: scale(perRound, meta.roundsPerHour),
    roundsPerHour: meta.roundsPerHour,
    avgInitialBet: st.roundsPlayed ? st.initialWagered / st.roundsPlayed : NaN,
    avgAtRisk: st.roundsPlayed ? totalWagered / st.roundsPlayed : NaN,
    sdRound,
    sdPer100: Math.sqrt(100 * st.perRound.clusterVariancePerUnit),
    bins: TC_BINS.map((label, i) => {
      const b = st.bins[i];
      return {
        label,
        opportunityShare: st.roundsObserved ? b.opportunities / st.roundsObserved : 0,
        wagerShare: st.initialWagered ? b.initialWagered / st.initialWagered : 0,
        roundsPlayed: b.played,
        edgeOnInitial: b.initialWagered ? b.net / b.initialWagered : null,
      };
    }),
    deviationsApplied: st.deviationsApplied,
    deviationFallbacks: st.deviationFallbacks,
    penetration: {
      cutCardIndex: cut,
      cutFraction: cut / totalCards,
      avgCardsDealtPerShoe: st.completedShoes ? st.cardsDealtAtShuffle / st.completedShoes : null,
      avgDealtFraction: st.completedShoes ? st.cardsDealtAtShuffle / st.completedShoes / totalCards : null,
      roundsPerShoe: st.shoes ? st.roundsObserved / st.shoes : null,
      reshufflesPer100Rounds: st.roundsObserved ? (st.completedShoes / st.roundsObserved) * 100 : 0,
    },
    runtimeMs: meta.runtimeMs,
    roundsPerSecond: meta.runtimeMs ? (st.roundsObserved / meta.runtimeMs) * 1000 : 0,
  };
}

function runChunked(runner: SessionRunner, total: number, base: number, overall: number, progress?: Progress) {
  while (!runner.step(CHUNK)) progress?.(base + runner.roundsDone, overall);
  progress?.(base + runner.roundsDone, overall);
}

/** Expected value with an unlimited bankroll. */
export function runEv(req: EvRequest, progress?: Progress): EvSummary & { shoeNets: number[]; shoeRounds: number[] } {
  const t0 = now();
  const runner = new SessionRunner(req.sim, { rounds: req.rounds, bankroll: null }, seededRng(req.seed));
  runChunked(runner, req.rounds, 0, req.rounds, progress);
  const r = runner.result();
  return { ...summarize(r.stats, req.sim, { seed: req.seed, rounds: req.rounds, roundsPerHour: req.roundsPerHour, runtimeMs: now() - t0 }), shoeNets: r.shoeNets, shoeRounds: r.shoeRounds };
}

// ---------------------------------------------------------------------------

export interface CompareRequest {
  readonly sim: Omit<SimConfig, "ramp">;
  readonly ramps: readonly BettingRamp[];
  readonly rounds: number;
  readonly seed: number;
  readonly roundsPerHour: number;
}

export interface CompareRow {
  readonly ramp: BettingRamp;
  readonly spread: string;
  readonly summary: EvSummary;
  /** Difference in net per 100 rounds vs the first strategy, with a 95% interval. */
  readonly vsBaselinePer100: Interval | null;
  readonly distinguishable: boolean | null;
}

export interface CompareResult {
  readonly rows: readonly CompareRow[];
  /** True when every strategy saw exactly the same shoes and rounds (paired comparison). */
  readonly paired: boolean;
  readonly note: string;
}

/**
 * Common random numbers: every strategy uses the same seed, so the same
 * shuffles. With an unlimited bankroll and the same playing strategy, bets
 * never change which cards are dealt, so each shoe is identical across
 * strategies and differences are estimated from shoe-level paired
 * differences (much tighter than independent runs).
 */
export function runCompare(req: CompareRequest, progress?: Progress): CompareResult {
  const total = req.rounds * req.ramps.length;
  const runs = req.ramps.map((ramp, i) =>
    runEv({ sim: { ...req.sim, ramp }, rounds: req.rounds, seed: req.seed, roundsPerHour: req.roundsPerHour }, (d) => progress?.(i * req.rounds + d, total)),
  );
  const base = runs[0];
  const paired = runs.every((r) => r.shoeRounds.length === base.shoeRounds.length && r.shoeRounds.every((n, k) => n === base.shoeRounds[k]));
  const rows = runs.map((r, i): CompareRow => {
    let diff: Interval | null = null;
    if (i > 0) {
      if (paired) {
        const d = r.shoeNets.map((x, k) => x - base.shoeNets[k]);
        const rounds = base.shoeRounds.reduce((a, b) => a + b, 0);
        const ms = meanSe(d);
        const perRound = (ms.mean * d.length) / rounds;
        const se = (ms.se * d.length) / rounds;
        diff = normalInterval(perRound * 100, se * 100);
      } else {
        const a = r.per100;
        const b = base.per100;
        const seA = (a.high - a.low) / (2 * 1.959964);
        const seB = (b.high - b.low) / (2 * 1.959964);
        diff = normalInterval(a.estimate - b.estimate, Math.sqrt(seA * seA + seB * seB));
      }
    }
    const { shoeNets: _n, shoeRounds: _r, ...summary } = r;
    void _n;
    void _r;
    return { ramp: req.ramps[i], spread: spreadOf(req.ramps[i]), summary, vsBaselinePer100: diff, distinguishable: diff ? distinguishable(diff) : null };
  });
  return {
    rows,
    paired,
    note: paired
      ? "All strategies saw identical shoes and cards (same seed, unlimited bankroll, same playing strategy), so differences use shoe-by-shoe paired comparisons."
      : "Strategies did not see identical card sequences (different playing decisions or bankroll limits), so differences use independent-sample intervals.",
  };
}

// ---------------------------------------------------------------------------

export interface RorRequest {
  readonly sim: SimConfig;
  readonly bankroll: number;
  /** Session length in rounds (finite horizon). */
  readonly rounds: number;
  readonly trials: number;
  readonly profitTarget: number;
  readonly seed: number;
  /** Number of trials whose bankroll path is kept for plotting. */
  readonly samplePaths: number;
}

export interface RorSummary {
  readonly bankroll: number;
  readonly rounds: number;
  readonly trials: number;
  /** Probability of going broke (unable to place the minimum bet) within the horizon. */
  readonly ruin: Interval;
  /** Probability the bankroll ever reached bankroll + target within the horizon. */
  readonly target: Interval;
  readonly profitTarget: number;
  readonly endingPercentiles: Readonly<Record<"p5" | "p25" | "p50" | "p75" | "p95", number>>;
  readonly meanEnding: Interval;
  readonly drawdownPercentiles: Readonly<Record<"p50" | "p75" | "p95", number>>;
  /** Histogram of session profit (ending − starting bankroll). */
  readonly profitHistogram: readonly { from: number; to: number; count: number }[];
  readonly paths: readonly number[][];
  readonly pathEvery: number;
  readonly medianRuinRound: number | null;
  readonly runtimeMs: number;
}

/**
 * Finite-horizon risk of ruin by direct simulation: independent sessions
 * (trial i uses seed f(seed, i), shared across bankrolls and strategies for
 * common random numbers), each with full settlement — doubles, splits and
 * insurance need covering chips, and a session ends when the bankroll cannot
 * cover the table minimum.
 */
export function runRor(req: RorRequest, progress?: Progress): RorSummary {
  const t0 = now();
  const pathEvery = Math.max(1, Math.round(req.rounds / 60));
  const ending: number[] = [];
  const drawdown: number[] = [];
  const ruinRounds: number[] = [];
  const paths: number[][] = [];
  let ruined = 0;
  let target = 0;
  for (let t = 0; t < req.trials; t++) {
    const keep = t < req.samplePaths;
    const runner = new SessionRunner(
      req.sim,
      { rounds: req.rounds, bankroll: req.bankroll, profitTarget: req.profitTarget, pathEvery: keep ? pathEvery : 0 },
      seededRng(jobSeed(req.seed, t)),
      emptyStats(),
    );
    runner.step(Number.MAX_SAFE_INTEGER);
    const r = runner.result();
    ending.push(r.endingBankroll);
    drawdown.push(r.maxDrawdown);
    if (r.ruined) {
      ruined++;
      ruinRounds.push(r.ruinRound!);
    }
    if (r.reachedTarget) target++;
    if (keep) paths.push([req.bankroll, ...r.path]);
    progress?.(t + 1, req.trials);
  }
  const sortedEnd = [...ending].sort((a, b) => a - b);
  const sortedDd = [...drawdown].sort((a, b) => a - b);
  const ms = meanSe(ending);
  const profits = ending.map((e) => e - req.bankroll);
  const lo = Math.min(...profits);
  const hi = Math.max(...profits);
  const binsN = 24;
  const width = (hi - lo) / binsN || 1;
  const hist = Array.from({ length: binsN }, (_, i) => ({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 }));
  for (const p of profits) hist[Math.min(binsN - 1, Math.floor((p - lo) / width))].count++;
  const sortedRuin = ruinRounds.sort((a, b) => a - b);
  return {
    bankroll: req.bankroll,
    rounds: req.rounds,
    trials: req.trials,
    ruin: wilson(ruined, req.trials),
    target: wilson(target, req.trials),
    profitTarget: req.profitTarget,
    endingPercentiles: {
      p5: percentile(sortedEnd, 0.05),
      p25: percentile(sortedEnd, 0.25),
      p50: percentile(sortedEnd, 0.5),
      p75: percentile(sortedEnd, 0.75),
      p95: percentile(sortedEnd, 0.95),
    },
    meanEnding: normalInterval(ms.mean, ms.se),
    drawdownPercentiles: { p50: percentile(sortedDd, 0.5), p75: percentile(sortedDd, 0.75), p95: percentile(sortedDd, 0.95) },
    profitHistogram: hist,
    paths,
    pathEvery,
    medianRuinRound: sortedRuin.length ? percentile(sortedRuin, 0.5) : null,
    runtimeMs: now() - t0,
  };
}

/**
 * Infinite-horizon risk of ruin approximation (diffusion / normal
 * approximation): RoR ≈ exp(−2·μ·B / σ²) with μ and σ the mean and SD of one
 * round's result. Assumes a constant per-round mean and variance, no table
 * minimum and play forever. An approximation, not a simulated result.
 */
export function approximateEventualRor(perRoundMean: number, perRoundSd: number, bankroll: number): number {
  if (!(perRoundMean > 0)) return 1;
  return Math.exp((-2 * perRoundMean * bankroll) / (perRoundSd * perRoundSd));
}

// ---------------------------------------------------------------------------

export interface PenetrationRequest {
  readonly sim: SimConfig;
  readonly penetrations: readonly number[];
  readonly rounds: number;
  readonly seed: number;
  readonly roundsPerHour: number;
}

export interface PenetrationRow {
  readonly penetration: number;
  readonly summary: EvSummary;
  /** Share of betting opportunities with TC ≥ +1 and ≥ +2. */
  readonly favourable1: number;
  readonly favourable2: number;
}

export function runPenetration(req: PenetrationRequest, progress?: Progress): PenetrationRow[] {
  const total = req.rounds * req.penetrations.length;
  return req.penetrations.map((p, i) => {
    const r = runEv(
      { sim: { ...req.sim, rules: { ...req.sim.rules, penetration: p } }, rounds: req.rounds, seed: req.seed, roundsPerHour: req.roundsPerHour },
      (d) => progress?.(i * req.rounds + d, total),
    );
    const { shoeNets: _n, shoeRounds: _r, ...summary } = r;
    void _n;
    void _r;
    const share = (from: number) => summary.bins.slice(from).reduce((a, b) => a + b.opportunityShare, 0);
    return { penetration: p, summary, favourable1: share(4), favourable2: share(5) };
  });
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
