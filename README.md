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

## Rule assumptions

- US hole card with dealer peek. No-hole-card (ENHC) games are not supported.
- Surrender is late surrender only.
- Insurance is not offered.
- A 21 after a split is not a blackjack.

Pairs split by point value, so K-10 counts as a pair. Doubling restrictions, DAS, the split-hand limit, resplitting aces and hitting split aces are all configurable.

Non-standard games such as Blackjack Elite go in `RulesVariant` (`rules.ts`), but only once their official rules and a verified strategy exist.
