# BJ Trainer

Local-first blackjack training: basic strategy, Hi-Lo running count and true-count conversion. Next.js (App Router), TypeScript strict, Tailwind v4, shadcn/ui (Base UI), Vitest. No backend; settings and stats are stored in `localStorage`.

```bash
npm run dev            # http://localhost:3000
npm test               # Vitest
npm run typecheck
npm run lint
npm run generate:strategy   # regenerate strategy tables (≈45 s for all ten)
npm run chart -- 2 H17 DAS LS   # print a chart: decks, H17|S17, DAS|noDAS, LS|noLS
```

## Layout

- `src/lib/blackjack/`: the engine. Pure TypeScript with no React.
  - `cards`, `rng` (seeded Mulberry32, Fisher–Yates), `shoe` (finite, immutable, cut card), `hand`, `dealer`, `rules`, `counting`, `engine` (table state machine), `strategy` (decision evaluation)
  - `analysis/`: the combinatorial analyzer that produces the strategy tables
  - `strategy-data/*.json`: generated EV tables for 1/2/4/6/8 decks × H17/S17
- `src/lib/training/`: drill generation, grading, explanations and stats reducers
- `src/lib/storage/`: SSR-safe persistent stores
- `src/components/`, `src/app/`: UI
- `tests/`: Vitest suites

## Where the strategy comes from

Strategy charts are not typed in by hand. `analysis/ca.ts` computes exact expected values for stand, hit, double and split from a finite shoe:
- the player's cards and the upcard are removed from the shoe;
- the dealer peeks for blackjack, and the hole card is modeled explicitly, so the player's draws use the posterior hole-card distribution.

Each hard and soft cell averages the EVs over the two-card hands that make that total, weighted by probability. This is the usual total-dependent basic strategy. Splits are computed without resplitting.

The trainer grades a decision by picking the best EV among the actions that are legal at that moment. Actions within 5e-5 of a bet of each other count as ties, and either one is accepted. Explanations quote the EVs.

`tests/strategy.test.ts` checks the generated 6-deck S17 and H17 charts cell by cell against the published 6-deck charts (with and without DAS). It also checks the documented differences for double deck and single deck, and confirms that the committed JSON can be regenerated exactly.

## Table simulator

The UI drives the engine through two pure modules:

- **`table-session.ts`**: one human seat plus AI seats. It handles dealing a round, the human's actions (after which AI seats play automatically by basic strategy), buy-ins, and session stats. AI seats bet the table minimum.
- **`table-view.ts`**: `buildTableView(state, revealed)` replays the round's event log up to `revealed` events. This is how the UI animates deals that the engine resolves all at once.

The view is the information boundary:
- Face-down cards carry no rank, suit or id.
- The shoe order is never included.
- Outcomes, bankroll changes and session stats appear only once the animation has caught up.

The live session lives in module scope inside `use-table.ts`, so components only ever receive the view. `tests/table.test.ts` checks every log prefix of many rounds and confirms that neither the hole card nor the next card in the shoe appears in the view before it should.

Shoe handling:
- The same physical shoe is dealt in order across rounds until the cut card comes out. The reshuffle happens before the next round.
- If too few cards remain to start a round safely (`minimumCardsForRound`), the shoe ends early. This is recorded with the shuffle reason `insufficient-cards`.
- If the shoe still runs out mid-round, the discards are reshuffled to finish the round. The original shoe is kept in `state.interruptedShoe`, the count is flagged `valid: false`, and the old-pack hole card is never counted into the makeshift pack.

`TableView.count` (exposed cards only) and `TableView.shoe` are there for the Phase 6 counting overlay, which should read only the view.

## Counting and strategy training at the table

`src/lib/training/table/` holds pure modules that observe the table session. They never change how the game runs.

- **`training-table.ts`** coordinates everything:
  - It grades each human decision *before* executing it, and executes the chosen action unchanged.
  - It snapshots the count after every round, when all cards are face up.
  - It opens count checks only at stable points: between rounds, or on the player's own turn for manual checks.
  - It detects the end of the shoe exactly as the engine will: cut card, too few cards, or exhaustion.
- **`count-checks.ts`** works out the correct answers from the table view, so a hole card that hasn't been revealed is never included.
  - Decks remaining means undealt cards, including those behind the cut card.
  - The expected true count uses the quarter-deck estimate and the user's rounding setting.
  - Running count, true count, deck estimation and true-count arithmetic are graded separately.
  - Skipped checks are recorded as unanswered and never count as correct.
- **`decisions.ts`** grades decisions with the EV tables and tags each one:
  - `table`: a two-card hand. The EV is the table's average for that total, so the loss is still an estimate.
  - `approximate`: a multi-card hand, a hand after a split, or a split decision (resplits aren't modeled).
  - `ungraded`: split aces that can be hit, which the tables don't model.
- **`modes.ts`** is the single source of truth for what Beginner, Intermediate and Casino may show.
- **`shoe-tracker.ts`** builds the end-of-shoe report, and **`history.ts`** handles versioned storage in localStorage (`bjtrain.shoes`).
  - History keeps at most 200 shoes, and full decision logs only for the latest 20.
  - Interrupted (count-invalid) shoes are excluded from counting aggregates.

## Rule assumptions

- US hole card with dealer peek. No-hole-card (ENHC) games are not supported.
- Surrender is late surrender only.
- Insurance is not offered.
- A 21 after a split is not a blackjack.

Pairs split by point value, so K-10 counts as a pair. Doubling restrictions, DAS, the split-hand limit, resplitting aces and hitting split aces are all configurable.

Non-standard games such as Blackjack Elite go in `RulesVariant` (`rules.ts`), but only once their official rules and a verified strategy exist.
