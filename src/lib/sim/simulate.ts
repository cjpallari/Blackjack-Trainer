/**
 * Batch blackjack simulation on top of the reference engine (engine.ts).
 *
 * The engine already deals physical shoes without replacement, completes the
 * round when the cut card comes out, reshuffles only between rounds, ends a
 * shoe early when too few cards remain, and flags mid-round exhaustion. It
 * runs ~150–400k rounds/s in Node, so the simulator reuses it rather than a
 * separate fast path that would need its own proof of equivalence.
 *
 * Information boundaries:
 * - Bets come from `preBetObservation(state)`: the Hi-Lo count of exposed
 *   cards, the number of cards left in the shoe, and the bankroll.
 * - Plays use basic strategy, or Monte Carlo-validated indices evaluated from
 *   the visible count (the hole card is not exposed until revealed).
 * Neither ever reads the shoe's card order or the undealt composition.
 */
import type { TrueCountRounding } from "../blackjack/counting";
import { CELL_BY_ID } from "../blackjack/deviations/definitions";
import { cellRuleReason, cellUnavailableReason, evaluateDeviation, matchCell, resolveIndexSet, type IndexSet } from "../blackjack/deviations/registry";
import {
  act,
  availableActions,
  basicStrategyAction,
  createGame,
  maxInsurance,
  minimumCardsForRound,
  resolveInsurance,
  startRound,
  type GameState,
} from "../blackjack/engine";
import type { Rng } from "../blackjack/rng";
import type { TableRules } from "../blackjack/rules";
import { cardsRemaining } from "../blackjack/shoe";
import type { PlayerAction } from "../blackjack/strategy";
import { decideBet, quarterDeckEstimate, type BetLimits, type BettingRamp, type PreBetObservation } from "../betting/ramp";
import { RatioAccumulator } from "./stats";

export type PlayStrategy = "basic" | "deviations";

export interface SimConfig {
  readonly rules: TableRules;
  /** Other players at the table (basic strategy, minimum bets, no insurance). */
  readonly otherPlayers: number;
  /** 0-based seat of the simulated player, counted from first base. */
  readonly seat: number;
  readonly ramp: BettingRamp;
  readonly limits: BetLimits;
  readonly convention: TrueCountRounding;
  readonly play: PlayStrategy;
}

/** True-count bins for distributions: ≤ −3, −2 … +4, ≥ +5. */
export const TC_BINS = ["≤−3", "−2", "−1", "0", "+1", "+2", "+3", "+4", "≥+5"] as const;
export function tcBin(tc: number): number {
  const t = Math.floor(tc + 1e-9); // "exact" conventions bin by floor
  return Math.max(0, Math.min(TC_BINS.length - 1, t + 3));
}

export interface BinStats {
  /** Betting opportunities (rounds observed before the bet). */
  opportunities: number;
  /** Rounds the player actually bet. */
  played: number;
  initialWagered: number;
  net: number;
}

export interface SessionStats {
  roundsObserved: number;
  roundsPlayed: number;
  /** Sum of initial wagers (the bet placed before the deal). */
  initialWagered: number;
  /** Extra money put out by doubling and splitting. */
  additionalWagered: number;
  insuranceWagered: number;
  /** Net result including insurance. */
  net: number;
  insuranceNet: number;
  sumSqRoundNet: number;
  hands: number;
  shoes: number;
  invalidShoes: number;
  /** Rounds dealt from shoes that were interrupted (excluded from EV estimators). */
  invalidRounds: number;
  /** Two-card index decisions where no validated index existed, so basic strategy was used. */
  deviationFallbacks: number;
  deviationsApplied: number;
  /** Cards dealt from each completed shoe, summed (to compare with the cut card position). */
  cardsDealtAtShuffle: number;
  completedShoes: number;
  bins: BinStats[];
  /** Shoe-level cluster sums for net per round / initial / total wagered. */
  perRound: RatioAccumulator;
  perInitial: RatioAccumulator;
  perTotal: RatioAccumulator;
}

export function emptyStats(): SessionStats {
  return {
    roundsObserved: 0,
    roundsPlayed: 0,
    initialWagered: 0,
    additionalWagered: 0,
    insuranceWagered: 0,
    net: 0,
    insuranceNet: 0,
    sumSqRoundNet: 0,
    hands: 0,
    shoes: 0,
    invalidShoes: 0,
    invalidRounds: 0,
    deviationFallbacks: 0,
    deviationsApplied: 0,
    cardsDealtAtShuffle: 0,
    completedShoes: 0,
    bins: TC_BINS.map(() => ({ opportunities: 0, played: 0, initialWagered: 0, net: 0 })),
    perRound: new RatioAccumulator(),
    perInitial: new RatioAccumulator(),
    perTotal: new RatioAccumulator(),
  };
}

/** What a player can see before betting the next round. */
export function preBetObservation(state: GameState, bankroll: number): PreBetObservation {
  const full = state.rules.decks * 52;
  // A shuffle is due (cut card out, too few cards for a round, or no round yet): the next round starts a fresh shoe.
  const freshShoe =
    state.roundNumber === 0 || state.reshufflePending || cardsRemaining(state.shoe) < minimumCardsForRound(state.seats.length);
  if (freshShoe) return { runningCount: 0, cardsInShoe: full, bankroll };
  return { runningCount: state.count.runningCount, cardsInShoe: cardsRemaining(state.shoe), bankroll };
}

/**
 * - use: a validated index for these rules and convention
 * - n/a: not an index play under these rules (e.g. a surrender index without surrender)
 * - fallback: an index play whose index is not validated; basic strategy is used and recorded
 */
type CellUse = "use" | "n/a" | "fallback";

interface PlayContext {
  readonly set: IndexSet | null;
  readonly convention: TrueCountRounding;
  readonly usable: Map<string, CellUse>;
}

function playContext(config: SimConfig): PlayContext {
  const r = config.play === "deviations" ? resolveIndexSet(config.rules, config.convention) : null;
  return { set: r && r.supported ? r.set : null, convention: config.convention, usable: new Map() };
}

function cellUse(ctx: PlayContext, rules: TableRules, cellId: string): CellUse {
  let u = ctx.usable.get(cellId);
  if (u === undefined) {
    if (!ctx.set) u = "fallback";
    else if (cellRuleReason(ctx.set, CELL_BY_ID.get(cellId)!, rules)) u = "n/a";
    else u = cellUnavailableReason(ctx.set, CELL_BY_ID.get(cellId)!, rules, ctx.convention) === null ? "use" : "fallback";
    ctx.usable.set(cellId, u);
  }
  return u;
}

/** Whether to apply the index; records fallbacks to basic strategy. */
function applyIndex(ctx: PlayContext, state: GameState, cellId: string, stats: SessionStats): boolean {
  const u = cellUse(ctx, state.rules, cellId);
  if (u === "n/a") return false;
  if (u === "fallback" || !state.count.valid) {
    stats.deviationFallbacks++;
    return false;
  }
  return true;
}

function humanAction(state: GameState, ctx: PlayContext, config: SimConfig, stats: SessionStats): PlayerAction {
  const basic = basicStrategyAction(state);
  if (config.play !== "deviations") return basic;
  const seat = state.seats[state.turn!.seat];
  const hand = seat.hands[state.turn!.hand];
  const cell = matchCell({ cards: hand.cards.map((c) => c.rank), up: state.dealer.cards[0].rank, fromSplit: hand.fromSplit });
  if (!cell || !applyIndex(ctx, state, cell.id, stats)) return basic;
  const legal = availableActions(state);
  const e = evaluateDeviation(ctx.set!, ctx.convention, {
    cell,
    runningCount: state.count.runningCount,
    decksEstimate: quarterDeckEstimate(cardsRemaining(state.shoe)),
    deckTolerance: 0,
    legal,
    basic,
  });
  const a = e.countAction as PlayerAction;
  if (a !== basic) stats.deviationsApplied++;
  return legal.includes(a) ? a : basic;
}

function insuranceAmount(state: GameState, humanId: number, ctx: PlayContext, config: SimConfig, stats: SessionStats): number {
  if (config.play !== "deviations" || state.seats[humanId].hands.length === 0) return 0;
  if (!applyIndex(ctx, state, "insurance", stats)) return 0;
  const e = evaluateDeviation(ctx.set!, ctx.convention, {
    cell: CELL_BY_ID.get("insurance")!,
    runningCount: state.count.runningCount,
    decksEstimate: quarterDeckEstimate(cardsRemaining(state.shoe)),
    deckTolerance: 0,
    legal: ["insure", "decline"],
    basic: "decline",
  });
  if (e.countAction !== "insure") return 0;
  stats.deviationsApplied++;
  return maxInsurance(state, humanId);
}

export interface SessionOptions {
  readonly rounds: number;
  /** Starting bankroll; null = unlimited (for expected-value runs). */
  readonly bankroll: number | null;
  /** Record the bankroll every this many rounds (0 = no path). */
  readonly pathEvery?: number;
  /** Profit target: records whether the bankroll ever reached start + target (play continues). */
  readonly profitTarget?: number;
}

export interface SessionResult {
  readonly stats: SessionStats;
  readonly startingBankroll: number;
  readonly endingBankroll: number;
  readonly ruined: boolean;
  readonly ruinRound: number | null;
  readonly reachedTarget: boolean;
  readonly maxDrawdown: number;
  readonly path: number[];
  /** Per valid shoe: net and rounds observed (for paired comparisons under common random numbers). */
  readonly shoeNets: number[];
  readonly shoeRounds: number[];
}

const UNLIMITED = 1e15;

/**
 * A resumable session: `step(n)` plays up to n more rounds, so long runs can
 * report progress without restarting shoes. Deterministic for a given rng.
 * Strategies run with the same seed see the same shuffles; with an unlimited
 * bankroll and the same playing strategy they see the same cards in the same
 * order, because bets never change play.
 */
export class SessionRunner {
  readonly stats: SessionStats;
  private state: GameState;
  private readonly rules: TableRules;
  private readonly humanId: number;
  private readonly seats: number;
  private readonly ctx: PlayContext;
  private readonly start: number;
  private played = 0;
  private done = false;
  private readonly path: number[] = [];
  private readonly shoeNets: number[] = [];
  private readonly shoeRounds: number[] = [];
  private peak: number;
  private maxDrawdown = 0;
  private ruined = false;
  private ruinRound: number | null = null;
  private reachedTarget = false;
  private shoeNo = -1;
  private shoeValid = true;
  private sObserved = 0;
  private sRounds = 0;
  private sNet = 0;
  private sInitial = 0;
  private sTotal = 0;
  private sPosition = 0;

  constructor(
    private readonly config: SimConfig,
    private readonly opts: SessionOptions,
    private readonly rng: Rng,
    stats: SessionStats = emptyStats(),
  ) {
    this.stats = stats;
    this.rules = { ...config.rules, minBet: config.limits.tableMin, maxBet: config.limits.tableMax, aiPlayers: config.otherPlayers };
    this.seats = config.otherPlayers + 1;
    this.humanId = Math.max(0, Math.min(this.seats - 1, config.seat));
    this.start = opts.bankroll ?? UNLIMITED;
    this.peak = this.start;
    this.state = createGame(
      this.rules,
      Array.from({ length: this.seats }, (_, i) =>
        i === this.humanId ? { kind: "human" as const, name: "Player", bankroll: this.start } : { kind: "ai" as const, name: `AI ${i}`, bankroll: UNLIMITED },
      ),
      rng,
    );
    this.ctx = playContext(config);
  }

  get roundsDone(): number {
    return this.played;
  }

  get finished(): boolean {
    return this.done;
  }

  private closeShoe(completed: boolean) {
    if (this.shoeNo < 0) return;
    const st = this.stats;
    st.shoes++;
    if (!this.shoeValid) {
      st.invalidShoes++;
      st.invalidRounds += this.sRounds;
      return;
    }
    if (completed) {
      st.completedShoes++;
      st.cardsDealtAtShuffle += this.sPosition;
    }
    if (this.sObserved > 0) {
      // Per round OBSERVED (time at the table); equals rounds played unless the ramp sits out.
      st.perRound.add(this.sNet, this.sObserved);
      st.perInitial.add(this.sNet, this.sInitial);
      st.perTotal.add(this.sNet, this.sTotal);
      this.shoeNets.push(this.sNet);
      this.shoeRounds.push(this.sObserved);
    }
  }

  /** Play up to `n` rounds. Returns true when the session is over. */
  step(n: number): boolean {
    const { config, rules, humanId, seats, ctx, stats, rng } = this;
    for (let i = 0; i < n && !this.done; i++) {
      if (this.played >= this.opts.rounds) {
        this.finish();
        break;
      }
      let state = this.state;
      const bankroll = state.seats[humanId].bankroll;
      const decision = decideBet(config.ramp, config.limits, preBetObservation(state, bankroll), config.convention);
      if (decision.kind === "insufficient-bankroll") {
        this.ruined = true;
        this.ruinRound = this.played;
        this.finish();
        break;
      }
      const bin = tcBin(decision.trueCount);
      stats.roundsObserved++;
      stats.bins[bin].opportunities++;
      const bet = decision.kind === "bet" ? decision.amount : 0;
      const bets: Record<number, number> = {};
      for (let s = 0; s < seats; s++) bets[s] = s === humanId ? bet : rules.minBet;

      state = startRound(state, bets, rng);
      if (state.shoeNumber !== this.shoeNo) {
        this.closeShoe(this.shoeNo >= 0);
        this.shoeNo = state.shoeNumber;
        this.shoeValid = true;
        this.sObserved = this.sRounds = this.sNet = this.sInitial = this.sTotal = 0;
      }
      if (state.phase === "insurance") {
        const amount = bet > 0 ? insuranceAmount(state, humanId, ctx, config, stats) : 0;
        state = resolveInsurance(state, amount > 0 ? { [humanId]: amount } : {}, rng);
      }
      while (state.phase === "playerTurn") {
        const human = state.seats[state.turn!.seat].kind === "human";
        state = act(state, human ? humanAction(state, ctx, config, stats) : basicStrategyAction(state), rng);
      }
      if (!state.count.valid) this.shoeValid = false;
      this.sPosition = state.shoe.position;
      this.sObserved++;

      if (bet > 0) {
        const seat = state.seats[humanId];
        const total = seat.hands.reduce((x, h) => x + h.bet, 0);
        const ins = seat.insurance;
        const net = seat.hands.reduce((x, h) => x + (h.net ?? 0), 0) + (ins?.net ?? 0);
        stats.roundsPlayed++;
        stats.hands += seat.hands.length;
        stats.initialWagered += bet;
        stats.additionalWagered += total - bet;
        stats.insuranceWagered += ins?.amount ?? 0;
        stats.insuranceNet += ins?.net ?? 0;
        stats.net += net;
        stats.sumSqRoundNet += net * net;
        stats.bins[bin].played++;
        stats.bins[bin].initialWagered += bet;
        stats.bins[bin].net += net;
        this.sRounds++;
        this.sNet += net;
        this.sInitial += bet;
        this.sTotal += total + (ins?.amount ?? 0);
      }
      this.state = state;
      this.played++;

      const b = state.seats[humanId].bankroll;
      if (b > this.peak) this.peak = b;
      if (this.peak - b > this.maxDrawdown) this.maxDrawdown = this.peak - b;
      if (this.opts.pathEvery && this.played % this.opts.pathEvery === 0) this.path.push(b);
      if (this.opts.profitTarget !== undefined && b >= this.start + this.opts.profitTarget) this.reachedTarget = true;
    }
    if (this.played >= this.opts.rounds) this.finish();
    return this.done;
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    this.closeShoe(false);
  }

  result(): SessionResult {
    return {
      stats: this.stats,
      startingBankroll: this.start,
      endingBankroll: this.state.seats[this.humanId].bankroll,
      ruined: this.ruined,
      ruinRound: this.ruinRound,
      reachedTarget: this.reachedTarget,
      maxDrawdown: this.maxDrawdown,
      path: this.path,
      shoeNets: this.shoeNets,
      shoeRounds: this.shoeRounds,
    };
  }
}

/** Run a whole session at once. */
export function simulateSession(config: SimConfig, opts: SessionOptions, rng: Rng, stats?: SessionStats): SessionResult {
  const r = new SessionRunner(config, opts, rng, stats);
  r.step(Number.MAX_SAFE_INTEGER);
  return r.result();
}
