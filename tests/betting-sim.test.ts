import { describe, expect, it } from "vitest";
import { createGame, startRound, withShoe, act, basicStrategyAction, resolveInsurance } from "@/lib/blackjack/engine";
import { seededRng, shuffle } from "@/lib/blackjack/rng";
import { DEFAULT_RULES } from "@/lib/blackjack/rules";
import { createShoe } from "@/lib/blackjack/shoe";
import { decideBet, DEFAULT_LIMITS, observedTrueCount, RAMP_PRESETS, rampUnits, validateRamp, type BettingRamp } from "@/lib/betting/ramp";
import { approximateEventualRor, runCompare, runEv, runPenetration, runRor } from "@/lib/sim/analyses";
import { preBetObservation, simulateSession, tcBin, type SimConfig } from "@/lib/sim/simulate";
import { RatioAccumulator, wilson } from "@/lib/sim/stats";

const ramp = (id: string) => RAMP_PRESETS.find((r) => r.id === id)!;
const SIM: SimConfig = { rules: DEFAULT_RULES, otherPlayers: 2, seat: 1, ramp: ramp("flat"), limits: DEFAULT_LIMITS, convention: "truncate", play: "basic" };

describe("betting ramps", () => {
  const r18 = ramp("1-8");
  it("maps true counts to units by threshold", () => {
    expect([-4, 0, 1, 2, 3, 4, 5, 9].map((t) => rampUnits(r18, t))).toEqual([1, 1, 1, 2, 4, 6, 8, 8]);
  });

  it("applies table limits, chip size and bankroll in that order", () => {
    const obs = (rc: number, cards: number, bankroll: number) => ({ runningCount: rc, cardsInShoe: cards, bankroll });
    // TC +5 with 1 deck left → 8 units × 25 = 200.
    expect(decideBet(r18, DEFAULT_LIMITS, obs(5, 52, 1000), "truncate")).toMatchObject({ kind: "bet", amount: 200, trueCount: 5 });
    expect(decideBet(r18, { ...DEFAULT_LIMITS, tableMax: 150 }, obs(5, 52, 1000), "truncate")).toMatchObject({ amount: 150, constrained: "table-max" });
    expect(decideBet({ ...r18, unit: 12 }, DEFAULT_LIMITS, obs(0, 52, 1000), "truncate")).toMatchObject({ amount: 25, constrained: "table-min" });
    expect(decideBet({ ...r18, unit: 27 }, DEFAULT_LIMITS, obs(2, 52, 1000), "truncate")).toMatchObject({ amount: 50, constrained: "chip" });
    expect(decideBet(r18, DEFAULT_LIMITS, obs(5, 52, 130), "truncate")).toMatchObject({ amount: 130, constrained: "bankroll" });
    expect(decideBet(r18, DEFAULT_LIMITS, obs(0, 52, 20), "truncate").kind).toBe("insufficient-bankroll");
    expect(decideBet(r18, DEFAULT_LIMITS, obs(0, 52, 0), "truncate").kind).toBe("insufficient-bankroll");
  });

  it("uses the configured rounding and a quarter-deck estimate", () => {
    expect(observedTrueCount({ runningCount: -5, cardsInShoe: 52 * 2 }, "truncate")).toBe(-2);
    expect(observedTrueCount({ runningCount: -5, cardsInShoe: 52 * 2 }, "floor")).toBe(-3);
    expect(observedTrueCount({ runningCount: 3, cardsInShoe: 40 }, "floor")).toBe(4); // 40 cards ≈ 0.75 decks
  });

  it("supports sitting out and validates ramps", () => {
    const wong: BettingRamp = { id: "w", name: "w", unit: 25, baseUnits: 0, steps: [{ minTc: 1, units: 2 }] };
    expect(decideBet(wong, DEFAULT_LIMITS, { runningCount: 0, cardsInShoe: 104, bankroll: 1000 }, "floor").kind).toBe("sit-out");
    expect(validateRamp(wong, DEFAULT_LIMITS, false)[0]).toMatch(/Sitting out/);
    expect(validateRamp(wong, DEFAULT_LIMITS, true)).toEqual([]);
    expect(validateRamp({ ...wong, steps: [{ minTc: 2, units: 2 }, { minTc: 1, units: 3 }] }, DEFAULT_LIMITS, true)[0]).toMatch(/increase/);
  });

  it("bins true counts consistently", () => {
    expect([-7, -3, -2, 0, 4, 5, 12].map(tcBin)).toEqual([0, 0, 1, 3, 7, 8, 8]);
    expect(tcBin(-1.4)).toBe(1); // exact counts bin by floor
  });
});

describe("information boundary for bets", () => {
  it("depends only on exposed cards and the number left, never on the undealt order", () => {
    const rng = seededRng(3);
    let g = createGame({ ...DEFAULT_RULES, minBet: 25, maxBet: 1000 }, [{ kind: "human", name: "p", bankroll: 1e6 }], rng);
    g = startRound(g, { 0: 25 }, rng);
    if (g.phase === "insurance") g = resolveInsurance(g, {}, rng);
    while (g.phase === "playerTurn") g = act(g, basicStrategyAction(g), rng);
    // Same exposed cards, but the undealt part of the shoe reshuffled.
    const seen = g.shoe.cards.slice(0, g.shoe.position);
    const rest = shuffle(g.shoe.cards.slice(g.shoe.position), seededRng(99));
    const g2 = { ...g, shoe: { ...g.shoe, cards: [...seen, ...rest] } };
    expect(preBetObservation(g2, 1000)).toEqual(preBetObservation(g, 1000));
    expect(decideBet(ramp("1-8"), DEFAULT_LIMITS, preBetObservation(g2, 1000), "floor")).toEqual(decideBet(ramp("1-8"), DEFAULT_LIMITS, preBetObservation(g, 1000), "floor"));
  });

  it("treats an upcoming shuffle as a fresh, zero count", () => {
    const rng = seededRng(4);
    const g = createGame(DEFAULT_RULES, [{ kind: "human", name: "p", bankroll: 1e6 }], rng);
    const pending = { ...withShoe(g, createShoe(2, rng)), roundNumber: 5, reshufflePending: true, count: { runningCount: 9, cardsSeen: 80, valid: true } };
    expect(preBetObservation(pending, 100)).toEqual({ runningCount: 0, cardsInShoe: 104, bankroll: 100 });
  });

  it("betting strategy never changes the cards dealt (unlimited bankroll, same play)", () => {
    const a = runEv({ sim: SIM, rounds: 20000, seed: 11, roundsPerHour: 100 });
    const b = runEv({ sim: { ...SIM, ramp: ramp("1-8") }, rounds: 20000, seed: 11, roundsPerHour: 100 });
    expect(b.shoeRounds).toEqual(a.shoeRounds);
    expect(b.bins.map((x) => x.roundsPlayed)).toEqual(a.bins.map((x) => x.roundsPlayed));
    expect(b.hands).toBe(a.hands);
    expect(b.penetration).toEqual(a.penetration);
  });
});

describe("accounting", () => {
  it("bankroll change equals net, and wagers add up (doubles, splits, insurance)", () => {
    const cfg: SimConfig = { ...SIM, ramp: ramp("1-8"), play: "deviations" };
    const r = simulateSession(cfg, { rounds: 20000, bankroll: 1e7 }, seededRng(5));
    const s = r.stats;
    expect(r.endingBankroll - r.startingBankroll).toBeCloseTo(s.net, 6);
    expect(s.additionalWagered).toBeGreaterThan(0);
    expect(s.insuranceWagered).toBeGreaterThan(0); // the insurance index is used at high counts
    const ev = runEv({ sim: cfg, rounds: 20000, seed: 5, roundsPerHour: 100 });
    expect(ev.totalWagered).toBeCloseTo(ev.initialWagered + ev.additionalWagered + ev.insuranceWagered, 6);
    expect(ev.avgAtRisk).toBeGreaterThan(ev.avgInitialBet);
    expect(ev.deviationFallbacks).toBe(0); // every index is validated for 2D H17
    expect(ev.deviationsApplied).toBeGreaterThan(0);
  });

  it("basic strategy never takes insurance", () => {
    const r = simulateSession(SIM, { rounds: 20000, bankroll: null }, seededRng(6));
    expect(r.stats.insuranceWagered).toBe(0);
  });

  it("identical seeds give identical results; different seeds differ", () => {
    const a = runEv({ sim: SIM, rounds: 10000, seed: 1, roundsPerHour: 100 });
    const b = runEv({ sim: SIM, rounds: 10000, seed: 1, roundsPerHour: 100 });
    const c = runEv({ sim: SIM, rounds: 10000, seed: 2, roundsPerHour: 100 });
    const strip = (x: typeof a) => ({ ...x, runtimeMs: 0, roundsPerSecond: 0 });
    expect(strip(b)).toEqual(strip(a));
    expect(c.net).not.toBe(a.net);
  });

  it("a bankroll that cannot cover the minimum places no wager", () => {
    const zero = simulateSession(SIM, { rounds: 100, bankroll: 0 }, seededRng(1));
    expect(zero.ruined).toBe(true);
    expect(zero.stats.roundsPlayed).toBe(0);
    const small = simulateSession({ ...SIM, ramp: ramp("1-8") }, { rounds: 5000, bankroll: 60 }, seededRng(2));
    expect(small.endingBankroll).toBeGreaterThanOrEqual(0);
    if (small.ruined) expect(small.endingBankroll).toBeLessThan(DEFAULT_LIMITS.tableMin);
  });

  it("6:5 vs 3:2 differs by exactly 0.3 bet per paid blackjack on identical shoes, and 6:5 is clearly negative", () => {
    // Payout does not change strategy, so the same seed deals the same cards and plays the same hands.
    const count = (payout: "3:2" | "6:5") => {
      const cfg: SimConfig = { ...SIM, otherPlayers: 0, seat: 0, rules: { ...DEFAULT_RULES, blackjackPayout: payout } };
      const r = simulateSession(cfg, { rounds: 40000, bankroll: null }, seededRng(12));
      return r.stats;
    };
    const a = count("3:2");
    const b = count("6:5");
    expect(a.hands).toBe(b.hands);
    const paidBlackjacks = Math.round((a.net - b.net) / (0.3 * 25));
    expect(a.net - b.net).toBeCloseTo(paidBlackjacks * 0.3 * 25, 6);
    // Naturals occur on ~4.8% of rounds; dealer pushes some.
    expect(paidBlackjacks / a.roundsPlayed).toBeGreaterThan(0.04);
    expect(paidBlackjacks / a.roundsPlayed).toBeLessThan(0.05);
    const six5 = runEv({ sim: { ...SIM, rules: { ...DEFAULT_RULES, blackjackPayout: "6:5" } }, rounds: 150000, seed: 8, roundsPerHour: 100 });
    expect(six5.edgeOnInitial.high).toBeLessThan(0);
  });
});

describe("penetration", () => {
  it("measures cards dealt per shoe at or past the cut card, and fewer reshuffles with deeper cuts", () => {
    const rows = runPenetration({ sim: SIM, penetrations: [0.5, 0.75], rounds: 15000, seed: 3, roundsPerHour: 100 });
    for (const r of rows) {
      const p = r.summary.penetration;
      expect(p.cutCardIndex).toBe(Math.round(104 * r.penetration));
      expect(p.avgCardsDealtPerShoe!).toBeGreaterThanOrEqual(p.cutCardIndex);
      expect(p.avgCardsDealtPerShoe!).toBeLessThan(p.cutCardIndex + 20);
    }
    expect(rows[1].summary.penetration.reshufflesPer100Rounds).toBeLessThan(rows[0].summary.penetration.reshufflesPer100Rounds);
    // Deeper penetration produces more high-count opportunities.
    expect(rows[1].favourable2).toBeGreaterThan(rows[0].favourable2);
  });
});

describe("spread comparison and risk of ruin", () => {
  it("compares spreads on identical shoes with paired intervals", () => {
    const c = runCompare({ sim: { ...SIM, play: "deviations" }, ramps: [ramp("flat"), ramp("1-8")], rounds: 20000, seed: 4, roundsPerHour: 100 });
    expect(c.paired).toBe(true);
    const d = c.rows[1].vsBaselinePer100!;
    expect(d.low).toBeLessThan(d.estimate);
    expect(c.rows[1].summary.avgInitialBet).toBeGreaterThan(c.rows[0].summary.avgInitialBet);
  });

  it("ruin falls with a larger bankroll and rises with larger bets (common random numbers)", () => {
    const base = { sim: SIM, rounds: 3000, trials: 120, profitTarget: 500, seed: 9, samplePaths: 3 };
    const small = runRor({ ...base, bankroll: 250 });
    const large = runRor({ ...base, bankroll: 1000 });
    const bigBets = runRor({ ...base, bankroll: 250, sim: { ...SIM, ramp: { ...ramp("flat"), unit: 50 }, limits: { ...DEFAULT_LIMITS, tableMin: 50 } } });
    expect(large.ruin.estimate).toBeLessThanOrEqual(small.ruin.estimate);
    expect(bigBets.ruin.estimate).toBeGreaterThanOrEqual(small.ruin.estimate);
    expect(small.paths).toHaveLength(3);
    expect(small.ruin.low).toBeLessThanOrEqual(small.ruin.estimate);
    expect(small.endingPercentiles.p5).toBeLessThanOrEqual(small.endingPercentiles.p95);
  });

  it("the eventual-ruin approximation behaves sensibly", () => {
    expect(approximateEventualRor(-0.1, 30, 1000)).toBe(1);
    expect(approximateEventualRor(0.5, 30, 2000)).toBeLessThan(approximateEventualRor(0.5, 30, 1000));
    expect(approximateEventualRor(0.5, 30, 1000)).toBeCloseTo(Math.exp(-1000 / 900), 12);
  });
});

describe("estimators", () => {
  it("cluster ratio SE matches the textbook formula", () => {
    const acc = new RatioAccumulator();
    const xs = [3, -2, 5, 0, -1];
    const ns = [10, 8, 12, 9, 11];
    xs.forEach((x, i) => acc.add(x, ns[i]));
    const R = 5 / 50;
    const ss = xs.reduce((s, x, i) => s + (x - R * ns[i]) ** 2, 0);
    expect(acc.ratio).toBeCloseTo(R, 12);
    expect(acc.se).toBeCloseTo(Math.sqrt((ss * 5) / 4) / 50, 12);
  });

  it("Wilson intervals stay inside [0, 1]", () => {
    const z = wilson(0, 50);
    expect(z.low).toBe(0);
    expect(z.high).toBeGreaterThan(0);
    const all = wilson(50, 50);
    expect(all.high).toBeCloseTo(1, 12);
  });
});
