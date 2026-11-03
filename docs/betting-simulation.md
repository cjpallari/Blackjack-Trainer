# Betting, expected value and bankroll simulation (Phase 8)

This document explains how the betting and bankroll simulator works and reports results measured on this machine.

> **Scope.** Every result here is for **conventional** blackjack with the rules stated. None of it applies to the Blackjack Elite game at El Dorado Hills Casino: its 6:5 natural payout, 3:2 suited A-K bonus and hard-31 behaviour are not modelled. These numbers do **not** suggest that game can be beaten.

## How it works

### Engine

- **Shared engine.** Simulations run the same reference engine the table uses (`src/lib/blackjack/engine.ts`). It already handles physical shoes shuffled with Fisher–Yates and dealt without replacement, dealing in seat order and completing the round after the cut card, plus everything else the table does: dealer peek, insurance, doubles, splits and surrender.
- **Shuffles.** The engine reshuffles only between rounds. It ends a shoe early, before dealing, when too few cards remain for a safe round.
- **Exhaustion.** If a shoe runs out mid-round, the shoe is flagged; it is excluded from expected-value estimates and the count of excluded shoes is reported.
- **Throughput.** The engine runs at about 150,000–190,000 rounds per second, so no separate fast path was needed. That avoids needing a second implementation that would have to be proven equivalent.

### Bets (`src/lib/betting/ramp.ts`)

- **Ramp.** A ramp maps the observed true count to a number of units. It has a unit size, units below the first threshold (0 means sit out, which needs another player at the table), and increasing thresholds.
- **What a bet may use.** Bets are sized from `preBetObservation` only:
  - the Hi-Lo count of cards already exposed;
  - the number of cards still in the shoe, estimated to the nearest quarter deck;
  - the bankroll.

  When a shuffle is due, the observation is a fresh count of 0.
- **Constraints.** The wager is capped by the table minimum and maximum, rounded down to the chip size, and capped by the bankroll. If the bankroll can't cover the table minimum, the session ends as ruined.
- **Shared with the table.** The table's betting trainer computes the same observation from the table view. A test checks that the two are always equal.

### Play

- **Two options.** Basic strategy, or basic strategy plus **Monte Carlo-validated** indices from Phase 7.1. The indices are evaluated from the visible count; the hole card is not counted until it is revealed.
- **Fallbacks.** When an index play has no validated index for the ruleset and rounding convention, basic strategy is used and the fallback is counted. It never borrows six-deck indices.
- **Insurance.** Taken only when the validated insurance index says so, at half the bet. Other players use basic strategy, bet the minimum and decline insurance.

### Seeds

Each run has a seed; the same seed and settings give identical results, and a test checks this.

**Common random numbers in spread comparisons.** All strategies use the same seed and therefore the same shuffles. With an unlimited bankroll and the same playing strategy, the bet never changes which cards are dealt, so every shoe is identical across strategies, and differences are measured shoe by shoe. A test checks this alignment.

**Risk-of-ruin sessions** use per-session seeds derived from the run seed. Bankroll limits and ruin make their paths diverge between strategies.

### Metrics and denominators

| Metric | Definition |
|---|---|
| Edge on initial wagers | Net result ÷ sum of initial bets (the bet placed before the deal). This is the usual "player edge". |
| Return on all money wagered | Net ÷ (initial bets + extra money for doubles and splits + insurance staked). It is smaller in magnitude and is not the edge. |
| Per round / per 100 rounds | Net ÷ rounds observed, × 100. Rounds observed equal rounds played unless the ramp sits out. |
| Per hour | Per-round result × an **assumed** number of rounds per hour (configurable, default 100). Illustrative only. |
| Average initial bet / at risk | Initial bets ÷ rounds played; total money wagered ÷ rounds played. |
| SD per round | Observed standard deviation of one round's result. |
| SD per 100 rounds | √(100 × shoe-level variance per round). This accounts for correlation between rounds within a shoe. |

### Uncertainty

- **Expected-value intervals** are 95% intervals from a cluster (linearised ratio) estimator with **whole shoes as the independent units**, because rounds in the same shoe share a count.
- **Spread differences** use shoe-level paired differences when the shoes align, and independent-sample intervals otherwise.
- **Ruin and target probabilities** use Wilson intervals over **independent sessions**.
- **Not distinguishable.** When an interval includes zero, or two strategies' intervals overlap, the UI says the run doesn't distinguish them.

### Risk of ruin

- **Finite horizon (simulated).** Independent sessions of *H* rounds from bankroll *B*, with full settlement: doubles, splits and insurance require covering chips, and a session ends when the bankroll can't cover the table minimum. The simulator reports:
  - the probability of ruin, and of reaching a profit target (at any point), with intervals;
  - percentiles of the ending bankroll and of the maximum drawdown;
  - a histogram of session profit and sample trajectories.
- **Eventual (approximation, not simulated).** RoR ≈ exp(−2μB/σ²), with μ and σ per round estimated from a separate expected-value run. This assumes infinite play with a constant mean and variance, and is labelled as an approximation. μ's own uncertainty moves it a lot.

### Why short-term results differ from expectation

At a 1–8 spread the SD per 100 rounds is roughly ten times the expected gain per 100 rounds. Over a few hundred rounds, luck dominates. Even 10,000 rounds leave a wide spread of outcomes; see the risk-of-ruin table below. A winning session doesn't show an edge and a losing one doesn't show a mistake. Only intervals from large runs that exclude zero say anything about expectation.

## Validation

All of these are tests in `tests/betting-sim.test.ts` and `tests/betting-table.test.ts` unless noted.

- **Flat-bet house edge** (this report): see the first table below.
- **6:5 vs 3:2.** On identical shoes, the difference is exactly 0.3 × bet × the number of paid player blackjacks (4–5% of rounds). 6:5 flat betting is clearly negative.
- **Accounting.**
  - The bankroll change equals the summed net result, including insurance.
  - Total wagered = initial + doubles/splits + insurance.
  - Basic strategy never takes insurance.
  - No validated index falls back for 2-deck H17.
- **Information boundary.**
  - Bets are unchanged when the undealt part of the shoe is reshuffled.
  - A due shuffle is seen as a fresh count.
  - The table-view observation equals the engine-state observation over 120 rounds, including shuffles.
- **Betting doesn't change the game.** Flat and 1–8 runs with the same seed see identical shoes, rounds, hands and penetration.
- **Bankroll limits.** A zero bankroll places no wager. Bankrolls never go negative. Ruin falls with a larger bankroll and rises with larger bets, under common random numbers.
- **Penetration.** Cards dealt per shoe are at least the cut-card position and within one round of it. Deeper cuts shuffle less often and produce more TC ≥ +2 opportunities.
- **Estimators.** The cluster standard error matches the textbook formula. Wilson intervals stay within [0, 1].

## Measured results: 2 decks, H17, 3:2, DAS, no surrender, insurance offered, cut card at 70%

Settings for all runs below:
- truncate rounding;
- $25 units, $25–$1,000 table, $5 chips;
- 2 other players, player in seat 2;
- validated indices, except the flat house-edge runs, which use basic strategy heads-up.

All runs were on this machine (Apple M4, 10 cores, Node 22), one core per run.

### 1. Flat-betting house edge (basic strategy)

| Run | Rounds | Edge on initial wagers (95% CI) | Throughput |
|---|---|---|---|
| Flat, basic strategy, heads-up, seed 1 | 3,000,000 | −0.463% [−0.594%, −0.332%] | 189,838 rounds/s |
| Flat, basic strategy, heads-up, seed 2 | 3,000,000 | −0.454% [−0.585%, −0.323%] | 187,001 rounds/s |
| Flat, basic strategy, heads-up, seed 3 | 3,000,000 | −0.416% [−0.548%, −0.285%] | 187,920 rounds/s |
| Flat, basic strategy, heads-up, seed 4 | 3,000,000 | −0.404% [−0.535%, −0.273%] | 191,374 rounds/s |
| **Pooled (12M rounds)** | 12,000,000 | **−0.434%** (≈ ±0.066%) | |

**Comparison with published values.** Wizard of Odds' composition-dependent figure for 2 decks, H17, DAS, resplits to 4 is **−0.380%**. This app's exact off-the-top analysis (composition-dependent, no resplits) gives −0.424%. The simulation plays total-dependent basic strategy and includes the cut-card effect, both of which make results slightly worse than the composition-dependent figure. The pooled −0.434% ± 0.066% is consistent with these.

### 2. Spread comparison (2,000,000 rounds each, same shoes)

| Strategy | Edge on initial wagers | Return on all money wagered | Per 100 rounds | SD per 100 | Avg initial bet | vs flat, per 100 (paired) |
|---|---|---|---|---|---|---|
| Flat | −0.11% [−0.27%, 0.05%] | −0.10% | −$2.75 [−$6.78, $1.28] | $291 | $25.00 | baseline |
| 1–2 spread | 0.43% [0.26%, 0.60%] | 0.38% | $13.26 [$8.04, $18.48] | $376 | $30.77 | $16.01 [$14.10, $17.93] ✓ |
| 1–4 spread | 0.98% [0.79%, 1.17%] | 0.85% | $37.08 [$29.78, $44.37] | $526 | $37.77 | $39.83 [$35.26, $44.39] ✓ |
| 1–6 spread | 1.36% [1.14%, 1.58%] | 1.18% | $60.89 [$51.10, $70.69] | $707 | $44.78 | $63.65 [$56.25, $71.04] ✓ |
| 1–8 spread | 1.58% [1.34%, 1.81%] | 1.37% | $76.73 [$65.34, $88.12] | $822 | $48.67 | $79.49 [$70.34, $88.63] ✓ |

- **Flat** here uses validated indices, which recover about 0.3% over flat basic strategy (−0.11% vs −0.43%). Its interval includes zero, so flat betting with indices is **not** shown to be profitable.
- **Every spread** beats flat by a clearly non-zero paired margin.
- **Per hour** equals per 100 rounds here because the assumption is 100 rounds per hour.

### 3. True-count distribution (1–8 spread run)

| Pre-bet TC (truncate) | ≤−3 | −2 | −1 | 0 | +1 | +2 | +3 | +4 | ≥+5 |
|---|---|---|---|---|---|---|---|---|---|
| % of betting opportunities | 16.5% | 8.4% | 9.4% | 34.0% | 8.6% | 7.5% | 3.2% | 4.6% | 7.8% |
| % of initial wagers (1–8) | 8.5% | 4.3% | 4.9% | 17.4% | 4.4% | 7.7% | 6.5% | 14.3% | 32.0% |
| Edge in bin (point estimate) | −3.1% | −1.4% | −0.4% | −0.5% | 1.1% | 1.8% | 1.8% | 2.8% | 4.1% |

TC ≥ +2 occurs on 23% of rounds but receives 60% of the money wagered under a 1–8 ramp.

### 4. Penetration (1–8 spread, 1,000,000 rounds each, same seed)

| Cut card | Cards actually dealt / shoe | Rounds / shoe | Shuffles / 100 rounds | TC ≥ +1 | TC ≥ +2 | Edge on initial (1–8) | Per 100 rounds | SD / 100 |
|---|---|---|---|---|---|---|---|---|
| 50% (card 52, 52 behind) | 56.7 (54.5%) | 5.12 | 19.5 | 26.7% | 18.0% | 0.79% [0.46%, 1.11%] | $31.87 [$18.74, $45.00] | $670 |
| 60% (card 62, 42 behind) | 67.0 (64.4%) | 6.05 | 16.5 | 29.5% | 20.8% | 1.00% [0.67%, 1.33%] | $44.64 [$29.88, $59.39] | $753 |
| 65% (card 68, 36 behind) | 73.4 (70.6%) | 6.64 | 15.1 | 30.6% | 21.9% | 1.15% [0.81%, 1.48%] | $53.49 [$37.99, $68.99] | $791 |
| 70% (card 73, 31 behind) | 78.0 (75.0%) | 7.05 | 14.2 | 31.6% | 23.0% | 1.24% [0.90%, 1.57%] | $60.11 [$43.95, $76.27] | $824 |
| 71% (card 74, 30 behind) | 78.9 (75.9%) | 7.13 | 14.0 | 31.7% | 23.2% | 1.28% [0.94%, 1.61%] | $62.40 [$46.14, $78.66] | $830 |
| 75% (card 78, 26 behind) | 83.2 (80.0%) | 7.52 | 13.3 | 32.2% | 24.1% | 1.49% [1.16%, 1.83%] | $75.44 [$58.64, $92.24] | $857 |

- **Cut card vs. cards dealt.** The cut-card position triggers the shuffle, but the round in progress always finishes, so about 5 more cards are dealt than the cut position.
- **The reported casino setup.** 71% (cut 30 cards from the bottom) is the reported observation for the target casino, not a verified rule, and only applies here under conventional rules.
- **Precision.** Neighbouring settings (70% vs 71%) aren't distinguishable at this sample size; the 50% → 75% trend is.

### 5. Risk of ruin (1–8 spread, $25 units, sessions of 10,000 rounds, 600 sessions per bankroll)

| Starting bankroll | Broke within 10,000 rounds (95% CI) | Doubled (reached +bankroll) | Median ending | 5th / 95th pct ending | Max drawdown median / 95th |
|---|---|---|---|---|---|
| $1,000 | 78.8% [75.4%, 81.9%] | 52.8% [48.8%, 56.8%] | $3 | $0 / $17,105 | $2,133 / $8,113 |
| $2,500 | 56.0% [52.0%, 59.9%] | 61.8% [57.9%, 65.6%] | $13 | $0 / $21,254 | $4,919 / $9,488 |
| $5,000 | 26.3% [23.0%, 30.0%] | 73.2% [69.5%, 76.6%] | $11,394 | $0 / $24,545 | $6,338 / $10,827 |
| $10,000 | 6.3% [4.6%, 8.6%] | 52.3% [48.3%, 56.3%] | $17,469 | $13 / $29,545 | $6,888 / $12,939 |


With these bets and a $1,000–$2,500 bankroll, going broke within 10,000 rounds is more likely than not, despite a positive expectation. The median ending bankroll for $1,000 and $2,500 is near zero because most of those sessions end in ruin.

### Performance

| Path | Throughput |
|---|---|
| Node, heads-up, flat | ≈ 190,000 rounds/s per core |
| Node, 3 seats, indices | ≈ 145,000–160,000 rounds/s per core |
| Browser Web Worker | ≈ 160,000 rounds/s (a 50,000-round 1–8 run took 0.3 s, headless Chrome) |

Simulations never run on page load or on the Next.js server. Defaults are 100k rounds and 200 risk-of-ruin sessions; 1M–3M rounds are optional.

Reproduce the report runs with:

```
npx tsx scripts/sim-report.ts <task> <out.json>
```

where the task is `flat-<seed>`, `compare`, `penetration` or `ror-<bankroll>`.

## Limitations

1. **Total-dependent strategy.** Basic strategy comes from the total-dependent tables, and splits are evaluated without resplitting. The table does allow resplits during play.
2. **Index coverage.** Indices apply only to validated two-card plays and insurance. Multi-card stiffs use basic strategy.
3. **No cover play.** Bets follow the ramp exactly: no camouflage, no wonging rules beyond "sit out", and no session or time-based rules.
4. **Other players.** Their effect is limited to the cards they consume, which is how it works physically. They always play basic strategy.
5. **Hours are assumed.** Hands per hour is an assumption, so hourly figures are only as good as that number.
6. **The eventual-ruin figure is an approximation.** Only the finite-horizon figure is simulated.
7. **Only 2-deck H17 was characterised.** Other rulesets can be run in the app, but only 2-deck H17 has been measured in this report. Indices for 4 and 8 decks are not validated, so those configurations play basic strategy and count the fallbacks.
