# Hi-Lo deviation index validation (Phase 7.1)

This report covers how the app's Hi-Lo deviation indices were audited and validated. It is reproducible with:

```bash
npm run generate:indices   # synthetic estimates      → src/lib/blackjack/deviations/data/hilo-indices.json   (~2 min)
npm run validate:indices   # conditional Monte Carlo  → src/lib/blackjack/deviations/data/hilo-validation.json (~23 min, 9 workers)
npm run report:indices -- floor   # prints the comparison tables (also: truncate, nearest)
```

Throughout, the true count is the visible Hi-Lo running count divided by a quarter-deck estimate of the cards still in the shoe. "Visible" means dealt cards plus the player's hand and the upcard; the face-down hole card is excluded. Rounding is floor unless stated otherwise. "Index *i*" means the deviation is made when the true count is at least *i*.

## 1. Problems found in the Phase 7 generator

The Phase 7 generator modelled "the remaining shoe at true count *t*" as *D* decks with the running count spread across the Hi-Lo ranks in proportion. It evaluated plays at that single average composition, at two depths. It had five problems.

1. **Visible-card accounting (a bug).** The visible hand and upcard were removed *from* the model shoe. A player's true count already includes those cards, so the model was really describing a true count of *t* + (Hi-Lo tags of the visible cards) ÷ *D*.
   - For 9 v 2 the visible cards (a 2 up, and hands like 5-4 or 6-3) are all +1, so the effective count was about +2.4 TC too high at 1.25 decks. That made double-deck 9 v 2 look like an index near −2; the real value is +1.
   - The same bug pushed the two-card 16 v 10 index to about +2. It is the main reason several double-deck indices failed the depth-stability rule.
2. **A single average composition.** A true count does not determine the remaining composition: ten density, ace density and the neutral ranks all vary between shoes with the same count. The EV difference between two plays is not linear in the composition, so the EV at the average composition is not the average EV (Jensen's inequality).
3. **Bucket-midpoint mapping.** An integer true count stood for the middle of its raw range (for example 2.5 for floor-TC 2). Observed true counts cluster near zero, so the real average inside a bucket is closer to zero than its midpoint. The effect is that synthetic indices run low.
4. **Depth treated as two points.** Indices were taken at about 60% and about 30% of the shoe left, not over the realistic spread of decision points. Deck-estimation rounding, which applies to the player's quarter-deck estimate, was not modelled either.
5. **Activation on synthetic stability alone.** An index was active if the two depths agreed within one true count. That checks internal consistency, not correctness.

## 2. Corrections

- **Fixed the visible-card bug (1).** The model composition is now the *unseen* remainder at true count *t*. Each hand composition is evaluated on that remainder plus its own visible cards, which the analyzer then removes. Insurance uses tens ÷ unseen cards directly. A regression test covers this.
  - Effect: against the published six-deck Illustrious 18 and Fab 4, synthetic values now match 19 of 22 exactly (13 before) and all 22 within ±1. 16 v 10 comes out at 0.
- **Added an independent conditional Monte Carlo validator** (`analysis/mc-validate.ts`) as the authority for activation:
  - **Shoe states:** each sample is a real shoe state, taken as the first *k* cards of a shuffled shoe. Because shuffled order is exchangeable, this is an exact sample of the dealt set. *k* is uniform up to a 70% cut card.
  - **Hands:** every two-card hand and the upcard are enumerated, weighted by the probability of being dealt them from the remaining cards.
  - **EVs:** action EVs are exact for the true remaining composition. This is an offline oracle; the live app never sees it.
  - **Grouping:** results are grouped by the observable true count (visible running count ÷ quarter-deck estimate of the cards in the shoe) under floor, truncate and nearest rounding.
  - **Sampling:** 160 states per bucket from TC −6 to +8, plus a second pass of 640 states around each crossing. Seeds are fixed. Standard errors are clustered by shoe state.
- **Activation now requires Monte Carlo validation** for the exact ruleset (decks, H17/S17, double after split, surrender) and rounding convention. An index is validated only if all of the following hold:
  - every change of play lies between resolved buckets, meaning the best play's margin exceeds two standard errors with at least 30 states;
  - there is at most one unresolved bucket at each crossing;
  - the two halves of the sample agree within one true count.

  Anything else is *experimental* (shown, never graded) or *disabled*.
- **Grading uses the Monte Carlo result directly.** The play for each integer true count is that bucket's Monte Carlo best play.
  - On an unresolved crossing bucket, both plays are accepted; these are marked "±1" in the UI.
  - Beyond the tested range, the nearest resolved bucket applies; validated results are monotone, so this is safe.
  - "Exact" true counts are looked up with floor buckets, since raw ≥ *i* is the same as floor(raw) ≥ *i*.
- **Aligned the deck-estimation convention everywhere.** The trainer, the table and the validator all use the same definition of cards remaining: cards still in the shoe, which excludes the dealt but face-down hole card. Previously the trainer counted the hole card as undealt.

## 3. Comparison with published references

The published values are Wizard of Odds' six-deck Illustrious 18 and Fab 4, from simulation: S17, double after split and surrender allowed, decks rounded to the nearest half deck. For six-deck S17 the Monte Carlo (floor rounding) matches **16 of 22 exactly and all 22 within ±1**. The six differences:

| Play | Published | Monte Carlo (6D S17) | Why |
|---|---|---|---|
| 16 v 10 stand | 0 | +1 (±1) | Two-card hands only. At TC 0 hitting is better by 0.0006 ± 0.0008, a statistical tie, and the crossing bucket is accepted either way. Three-card 16 v 10 gives index **0** (2D H17: −1). The published value covers all 16s, and most multi-card 16s favour standing earlier. |
| 10,10 v 6 split | +4 | +5 | Splits are evaluated without resplitting, which undervalues splitting slightly. H17 gives +4. |
| 12 v 2 stand | +3 | +4 (±1) | Crossing bucket unresolved; both are accepted at +3/+4. |
| 12 v 5 stand | −2 | −1 (±1) | Crossing bucket unresolved; both are accepted at −2/−1. |
| 14 v 10 surrender | +3 | +4 (±1) | Unresolved crossing bucket; the published rounding convention differs (half-deck estimates). |
| 15 v A surrender | +1 | +2 (±1) | Unresolved crossing bucket; the published rounding convention differs. |

Basic-strategy EVs still match Wizard of Odds' composition-dependent tables to six decimal places (unchanged from Phase 7), and the basic-strategy tables are unchanged.

## 4. Monte Carlo results with uncertainty (priority plays, no surrender)

The run used 444,800 shoe states across 92 jobs (4 rulesets × 21 plays, plus 8 three-card diagnostics). Margins are the best play's EV advantage per unit bet ± one clustered standard error, at the two buckets around the crossing. Split halves are the index from even- and odd-numbered samples. Depth bands are point estimates by how much of the shoe had been dealt.

| Ruleset | Play | States | Floor index | Margin ± SE at crossing buckets | Split halves | Depth bands (0–30% / 30–50% / 50–70%) |
|---|---|---|---|---|---|---|
| 2D H17 NS | h16v10 | 6880 | stand ≥ +1 | 0: hit +0.0065±0.0014 (n=800); +1: stand +0.0039±0.0014 (n=800) | stand@1 / stand@1 | stand@1 / stand@1 / stand@1 |
| 2D H17 NS | h15v10 | 6240 | stand ≥ +4 | +3: hit +0.0037±0.0010 (n=1212); +4: stand +0.0061±0.0010 (n=1800) | stand@4 / stand@4 | stand@4 / stand@4 / stand@4 |
| 2D H17 NS | h11v1 | 4320 | double ≥ -2 | -3: hit +0.0194±0.0022 (n=909); -2: double +0.0039±0.0016 (n=1551) | double@-2 / double@-2 | double@-2 / double@-1 / double@-2 |
| 2D H17 NS | h9v2 | 3680 | double ≥ +1 | 0: hit +0.0096±0.0012 (n=983); +1: double +0.0054±0.0009 (n=1301) | double@1 / double@1 | double@1 / double@1 / double@1 |
| 2D H17 NS | h9v7 | 4320 | double ≥ +3 | +2: hit +0.0114±0.0014 (n=893); +3: double +0.0044±0.0014 (n=1195) | double@3 / double@3 | double@3 / double@3 / double@3 |
| 2D H17 NS | h16v9 | 7520 | stand ≥ +6 (±1) | +5: hit +0.0062±0.0024 (n=796); +6: stand +0.0039±0.0026 (n=794) | stand@6 / stand@6 | stand@6 / stand@6 / stand@6 |
| 2D H17 NS | insurance | 3680 | insure ≥ +3 | +2: decline +0.0079±0.0021 (n=1273); +3: insure +0.0141±0.0017 (n=1586) | insure@3 / insure@3 | insure@3 / insure@3 / insure@3 |
| 2D S17 NS | h16v10 | 6880 | stand ≥ +1 (±1) | 0: hit +0.0085±0.0012 (n=800); +1: stand +0.0022±0.0018 (n=800) | stand@1 / stand@1 | stand@2 / stand@1 / stand@1 |
| 2D S17 NS | h15v10 | 6880 | stand ≥ +4 (±1) | +3: hit +0.0016±0.0009 (n=1235); +4: stand +0.0050±0.0012 (n=1772) | stand@4 / stand@4 | stand@4 / stand@4 / stand@3 |
| 2D S17 NS | h11v1 | 3680 | double ≥ 0 | -1: hit +0.0139±0.0015 (n=891); 0: double +0.0080±0.0014 (n=1605) | double@0 / double@0 | double@0 / double@0 / double@1 |
| 2D S17 NS | h9v2 | 3680 | double ≥ +1 | 0: hit +0.0094±0.0013 (n=998); +1: double +0.0057±0.0009 (n=1305) | double@1 / double@1 | double@1 / double@1 / double@1 |
| 2D S17 NS | h9v7 | 4320 | double ≥ +3 (±1) | +2: hit +0.0116±0.0015 (n=899); +3: double +0.0016±0.0013 (n=1168) | double@3 / double@3 | double@3 / double@4 / double@3 |
| 2D S17 NS | h16v9 | 7520 | unresolved |  | stand@6 / stand@5 | — / stand@6 / stand@5 |
| 2D S17 NS | insurance | 4320 | insure ≥ +3 (±1) | +2: decline +0.0013±0.0016 (n=1917); +3: insure +0.0147±0.0015 (n=2077) | insure@3 / insure@3 | insure@2 / insure@3 / insure@3 |
| 6D S17 NS | h16v10 | 6880 | stand ≥ +1 (±1) | 0: hit +0.0006±0.0008 (n=800); +1: stand +0.0069±0.0009 (n=800) | stand@1 / stand@1 | stand@1 / stand@1 / stand@1 |
| 6D S17 NS | h15v10 | 7520 | stand ≥ +4 | +3: hit +0.0041±0.0007 (n=1007); +4: stand +0.0028±0.0007 (n=1085) | stand@4 / stand@4 | stand@4 / stand@4 / stand@4 |
| 6D S17 NS | h11v1 | 3680 | double ≥ +1 | 0: hit +0.0132±0.0010 (n=855); +1: double +0.0124±0.0011 (n=948) | double@1 / double@1 | double@1 / double@1 / double@1 |
| 6D S17 NS | h9v2 | 3680 | double ≥ +1 | 0: hit +0.0058±0.0007 (n=845); +1: double +0.0057±0.0008 (n=963) | double@1 / double@1 | double@1 / double@1 / double@1 |
| 6D S17 NS | h9v7 | 4320 | double ≥ +3 (±1) | +2: hit +0.0162±0.0010 (n=833); +3: double +0.0000±0.0011 (n=986) | double@4 / double@3 | double@3 / double@4 / double@4 |
| 6D S17 NS | h16v9 | 7520 | stand ≥ +5 | +4: hit +0.0037±0.0015 (n=800); +5: stand +0.0052±0.0016 (n=800) | stand@5 / stand@5 | — / stand@5 / stand@5 |
| 6D S17 NS | insurance | 4320 | insure ≥ +3 | +2: decline +0.0131±0.0016 (n=972); +3: insure +0.0062±0.0014 (n=1596) | insure@3 / insure@3 | insure@3 / insure@3 / insure@3 |

**Findings for the disputed plays:**

- **16 v 10 (two-card): +1** in every tested game, below the published 0. Hitting is ahead at TC 0 by 0.0065 ± 0.0014 in 2D H17, so the difference is real in double deck; in six deck it is a tie. Three-card 16 v 10 gives 0 (6D) to −1 (2D H17). The published 0 is a mixture of two-card and multi-card 16s. The app grades two-card hands only, so +1 is the correct index for what it grades.
- **15 v 10: +4** everywhere, matching the published value. With late surrender: surrender at 0, also matching.
- **11 v A depends on the rules.**
  - 2D H17: −2. Off the top, basic strategy doubles here, so the deviation is to *hit* below −2.
  - 2D S17: 0.
  - 6D S17: +1, matching the published value.
  - 6D H17: −1.
  - The published +1 is a six-deck S17 number and does not carry over.
- **9 v 2: +1** in all four rulesets, matching the published value. In double deck, basic strategy doubles off the top, yet hitting is better at floor-TC 0 mid-shoe (by 0.0096 ± 0.0012). This is exactly the play the old visible-card bug got wrong, reporting about −2.
- **9 v 7: +3**, matching the published value (6D H17: +4 ±1).
- **16 v 9:**
  - 6D: +5, matching the published value.
  - 2D H17: +6 (±1).
  - 2D S17 without surrender: **unresolved**. The crossing falls between +4 and +8, where few states occur, so it is experimental and not graded.
  - With surrender, the play becomes *surrender* (from 0 to +1) and resolves.
- **Insurance: +3** in all four rulesets under floor and truncate, matching the published value. Under nearest rounding, six deck gives +4 (±1).

## 5. Index status

Statuses are per ruleset and convention. The status rules are:
- **Validated:** graded, and practised in the trainer.
- **Experimental:** shown with its synthetic estimate, never graded.
- **Disabled:** not shown as an index.

Under every convention (floor, truncate, nearest), 155 of the 156 Monte Carlo-tested ruleset/play combinations are validated; the remaining one is experimental. Plays that need surrender count only where surrender is offered. Double after split affects only the 10,10 plays, and both DAS variants were tested.

| Decks | Soft 17 | Surrender | Validated | Experimental | Disabled |
|---|---|---|---|---|---|
| 2 | H17 | none | 18 / 18 | — | — |
| 2 | H17 | late | 21 / 21 | — | — |
| 2 | S17 | none | 17 / 18 | 16 v 9 (crossing between +4 and +8 unresolved) | — |
| 2 | S17 | late | 21 / 21 | — | — |
| 6 | S17 / H17 | none | 18 / 18 | — | — |
| 6 | S17 / H17 | late | 21 / 21 | — | — |
| 4, 8 | S17 / H17 | either | 0 | all (synthetic estimate only; not Monte Carlo-tested) | — |
| 1 | any | any | unsupported | — | — |

Individual plays can still be unavailable for rules reasons: doubling a 9 under a 10–11 restriction, or insurance turned off.

### Full comparison tables (floor)


### 2D H17 DAS NS (floor)

| Play | Published (6D S17) | Synthetic | Monte Carlo | Status |
|---|---|---|---|---|
| Insurance | insure ≥ +3 | Take insurance at TC ≥ +3, otherwise decline insurance | Take insurance at TC ≥ +3, otherwise decline insurance | validated |
| 16 v 10 | stand ≥ +0 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ +1, otherwise hit | validated |
| 15 v 10 | stand ≥ +4, surrender ≥ +0 | Stand at TC ≥ +4, otherwise hit | Stand at TC ≥ +4, otherwise hit | validated |
| 10,10 v 5 | split ≥ +5 | Split at TC ≥ +4, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10,10 v 6 | split ≥ +4 | Split at TC ≥ +4, otherwise stand | Split at TC ≥ +5 (±1), otherwise stand | validated |
| 10 v 10 | double ≥ +4 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +4 (±1), otherwise hit | validated |
| 12 v 3 | stand ≥ +2 | Stand at TC ≥ +1, otherwise hit | Stand at TC ≥ +2, otherwise hit | validated |
| 12 v 2 | stand ≥ +3 | Stand at TC ≥ +3, otherwise hit | Stand at TC ≥ +4, otherwise hit | validated |
| 11 v A | double ≥ +1 | Double at TC ≥ −1, otherwise hit | Double at TC ≥ −2, otherwise hit | validated |
| 9 v 2 | double ≥ +1 | Double at TC ≥ +1, otherwise hit | Double at TC ≥ +1, otherwise hit | validated |
| 10 v A | double ≥ +4 | Double at TC ≥ +2, otherwise hit | Double at TC ≥ +2, otherwise hit | validated |
| 9 v 7 | double ≥ +3 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +3, otherwise hit | validated |
| 16 v 9 | stand ≥ +5 | Stand at TC ≥ +4, otherwise hit | Stand at TC ≥ +6 (±1), otherwise hit | validated |
| 13 v 2 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ 0 (±1), otherwise hit | validated |
| 12 v 4 | stand ≥ +0 | Stand at TC ≥ 0, otherwise hit | Stand at TC ≥ 0, otherwise hit | validated |
| 12 v 5 | stand ≥ -2 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ −1, otherwise hit | validated |
| 12 v 6 | stand ≥ -1 | Stand at TC ≥ −3, otherwise hit | Stand at TC ≥ −3, otherwise hit | validated |
| 13 v 3 | stand ≥ -2 | Stand at TC ≥ −3, otherwise hit | Stand at TC ≥ −2, otherwise hit | validated |

### 2D H17 DAS LS (floor)

| Play | Published (6D S17) | Synthetic | Monte Carlo | Status |
|---|---|---|---|---|
| Insurance | insure ≥ +3 | Take insurance at TC ≥ +3, otherwise decline insurance | Take insurance at TC ≥ +3, otherwise decline insurance | validated |
| 16 v 10 | stand ≥ +0 | Surrender at TC ≥ −4, otherwise hit | Surrender at TC ≥ −2 (±1), otherwise hit | validated |
| 15 v 10 | stand ≥ +4, surrender ≥ +0 | Surrender at TC ≥ 0, otherwise hit | Surrender at TC ≥ 0, otherwise hit | validated |
| 10,10 v 5 | split ≥ +5 | Split at TC ≥ +4, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10,10 v 6 | split ≥ +4 | Split at TC ≥ +4, otherwise stand | Split at TC ≥ +5 (±1), otherwise stand | validated |
| 10 v 10 | double ≥ +4 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +4 (±1), otherwise hit | validated |
| 12 v 3 | stand ≥ +2 | Stand at TC ≥ +1, otherwise hit | Stand at TC ≥ +2, otherwise hit | validated |
| 12 v 2 | stand ≥ +3 | Stand at TC ≥ +3, otherwise hit | Stand at TC ≥ +4, otherwise hit | validated |
| 11 v A | double ≥ +1 | Double at TC ≥ −1, otherwise hit | Double at TC ≥ −2, otherwise hit | validated |
| 9 v 2 | double ≥ +1 | Double at TC ≥ +1, otherwise hit | Double at TC ≥ +1, otherwise hit | validated |
| 10 v A | double ≥ +4 | Double at TC ≥ +2, otherwise hit | Double at TC ≥ +2, otherwise hit | validated |
| 9 v 7 | double ≥ +3 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +3, otherwise hit | validated |
| 16 v 9 | stand ≥ +5 | Surrender at TC ≥ −1, otherwise hit | Surrender at TC ≥ +1, otherwise hit | validated |
| 13 v 2 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ 0 (±1), otherwise hit | validated |
| 12 v 4 | stand ≥ +0 | Stand at TC ≥ 0, otherwise hit | Stand at TC ≥ 0, otherwise hit | validated |
| 12 v 5 | stand ≥ -2 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ −1, otherwise hit | validated |
| 12 v 6 | stand ≥ -1 | Stand at TC ≥ −3, otherwise hit | Stand at TC ≥ −3, otherwise hit | validated |
| 13 v 3 | stand ≥ -2 | Stand at TC ≥ −3, otherwise hit | Stand at TC ≥ −2, otherwise hit | validated |
| 14 v 10 | surrender ≥ +3 | Surrender at TC ≥ +3, otherwise hit | Surrender at TC ≥ +4, otherwise hit | validated |
| 15 v 9 | surrender ≥ +2 | Surrender at TC ≥ +2, otherwise hit | Surrender at TC ≥ +3 (±1), otherwise hit | validated |
| 15 v A | surrender ≥ +1 | Surrender at TC ≥ −1, otherwise hit | Surrender at TC ≥ −2 (±1), otherwise hit | validated |

### 2D S17 DAS NS (floor)

| Play | Published (6D S17) | Synthetic | Monte Carlo | Status |
|---|---|---|---|---|
| Insurance | insure ≥ +3 | Take insurance at TC ≥ +3, otherwise decline insurance | Take insurance at TC ≥ +3 (±1), otherwise decline insurance | validated |
| 16 v 10 | stand ≥ +0 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ +1 (±1), otherwise hit | validated |
| 15 v 10 | stand ≥ +4, surrender ≥ +0 | Stand at TC ≥ +4, otherwise hit | Stand at TC ≥ +4 (±1), otherwise hit | validated |
| 10,10 v 5 | split ≥ +5 | Split at TC ≥ +5, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10,10 v 6 | split ≥ +4 | Split at TC ≥ +4, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10 v 10 | double ≥ +4 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +3 (±1), otherwise hit | validated |
| 12 v 3 | stand ≥ +2 | Stand at TC ≥ +2, otherwise hit | Stand at TC ≥ +3 (±1), otherwise hit | validated |
| 12 v 2 | stand ≥ +3 | Stand at TC ≥ +4, otherwise hit | Stand at TC ≥ +4 (±1), otherwise hit | validated |
| 11 v A | double ≥ +1 | Double at TC ≥ 0, otherwise hit | Double at TC ≥ 0, otherwise hit | validated |
| 9 v 2 | double ≥ +1 | Double at TC ≥ +1, otherwise hit | Double at TC ≥ +1, otherwise hit | validated |
| 10 v A | double ≥ +4 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +3, otherwise hit | validated |
| 9 v 7 | double ≥ +3 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +3 (±1), otherwise hit | validated |
| 16 v 9 | stand ≥ +5 | Stand at TC ≥ +4, otherwise hit | No deviation in the tested range | experimental: Monte Carlo inconclusive: Crossing between TC 4 and 8 is not resolved. |
| 13 v 2 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ 0, otherwise hit | validated |
| 12 v 4 | stand ≥ +0 | Stand at TC ≥ 0, otherwise hit | Stand at TC ≥ +1, otherwise hit | validated |
| 12 v 5 | stand ≥ -2 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ −1, otherwise hit | validated |
| 12 v 6 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ 0, otherwise hit | validated |
| 13 v 3 | stand ≥ -2 | Stand at TC ≥ −2, otherwise hit | Stand at TC ≥ −2 (±1), otherwise hit | validated |

### 2D S17 DAS LS (floor)

| Play | Published (6D S17) | Synthetic | Monte Carlo | Status |
|---|---|---|---|---|
| Insurance | insure ≥ +3 | Take insurance at TC ≥ +3, otherwise decline insurance | Take insurance at TC ≥ +3 (±1), otherwise decline insurance | validated |
| 16 v 10 | stand ≥ +0 | Surrender at TC ≥ −4, otherwise hit | Surrender at TC ≥ −3 (±1), otherwise hit | validated |
| 15 v 10 | stand ≥ +4, surrender ≥ +0 | Surrender at TC ≥ 0, otherwise hit | Surrender at TC ≥ 0, otherwise hit | validated |
| 10,10 v 5 | split ≥ +5 | Split at TC ≥ +5, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10,10 v 6 | split ≥ +4 | Split at TC ≥ +4, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10 v 10 | double ≥ +4 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +3 (±1), otherwise hit | validated |
| 12 v 3 | stand ≥ +2 | Stand at TC ≥ +2, otherwise hit | Stand at TC ≥ +3 (±1), otherwise hit | validated |
| 12 v 2 | stand ≥ +3 | Stand at TC ≥ +4, otherwise hit | Stand at TC ≥ +4 (±1), otherwise hit | validated |
| 11 v A | double ≥ +1 | Double at TC ≥ 0, otherwise hit | Double at TC ≥ 0, otherwise hit | validated |
| 9 v 2 | double ≥ +1 | Double at TC ≥ +1, otherwise hit | Double at TC ≥ +1, otherwise hit | validated |
| 10 v A | double ≥ +4 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +3, otherwise hit | validated |
| 9 v 7 | double ≥ +3 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +3 (±1), otherwise hit | validated |
| 16 v 9 | stand ≥ +5 | Surrender at TC ≥ −1, otherwise hit | Surrender at TC ≥ +1 (±1), otherwise hit | validated |
| 13 v 2 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ 0, otherwise hit | validated |
| 12 v 4 | stand ≥ +0 | Stand at TC ≥ 0, otherwise hit | Stand at TC ≥ +1, otherwise hit | validated |
| 12 v 5 | stand ≥ -2 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ −1, otherwise hit | validated |
| 12 v 6 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ 0, otherwise hit | validated |
| 13 v 3 | stand ≥ -2 | Stand at TC ≥ −2, otherwise hit | Stand at TC ≥ −2 (±1), otherwise hit | validated |
| 14 v 10 | surrender ≥ +3 | Surrender at TC ≥ +3, otherwise hit | Surrender at TC ≥ +4 (±1), otherwise hit | validated |
| 15 v 9 | surrender ≥ +2 | Surrender at TC ≥ +2, otherwise hit | Surrender at TC ≥ +3 (±1), otherwise hit | validated |
| 15 v A | surrender ≥ +1 | Surrender at TC ≥ +1, otherwise hit | Surrender at TC ≥ +1, otherwise hit | validated |

### 6D S17 DAS NS (floor)

| Play | Published (6D S17) | Synthetic | Monte Carlo | Status |
|---|---|---|---|---|
| Insurance | insure ≥ +3 | Take insurance at TC ≥ +3, otherwise decline insurance | Take insurance at TC ≥ +3, otherwise decline insurance | validated |
| 16 v 10 | stand ≥ +0 | Stand at TC ≥ 0, otherwise hit | Stand at TC ≥ +1 (±1), otherwise hit | validated |
| 15 v 10 | stand ≥ +4, surrender ≥ +0 | Stand at TC ≥ +4, otherwise hit | Stand at TC ≥ +4, otherwise hit | validated |
| 10,10 v 5 | split ≥ +5 | Split at TC ≥ +5, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10,10 v 6 | split ≥ +4 | Split at TC ≥ +4, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10 v 10 | double ≥ +4 | Double at TC ≥ +4, otherwise hit | Double at TC ≥ +4, otherwise hit | validated |
| 12 v 3 | stand ≥ +2 | Stand at TC ≥ +2, otherwise hit | Stand at TC ≥ +2, otherwise hit | validated |
| 12 v 2 | stand ≥ +3 | Stand at TC ≥ +3, otherwise hit | Stand at TC ≥ +4 (±1), otherwise hit | validated |
| 11 v A | double ≥ +1 | Double at TC ≥ +1, otherwise hit | Double at TC ≥ +1, otherwise hit | validated |
| 9 v 2 | double ≥ +1 | Double at TC ≥ +1, otherwise hit | Double at TC ≥ +1, otherwise hit | validated |
| 10 v A | double ≥ +4 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +4 (±1), otherwise hit | validated |
| 9 v 7 | double ≥ +3 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +3 (±1), otherwise hit | validated |
| 16 v 9 | stand ≥ +5 | Stand at TC ≥ +4, otherwise hit | Stand at TC ≥ +5, otherwise hit | validated |
| 13 v 2 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ −1, otherwise hit | validated |
| 12 v 4 | stand ≥ +0 | Stand at TC ≥ 0, otherwise hit | Stand at TC ≥ 0, otherwise hit | validated |
| 12 v 5 | stand ≥ -2 | Stand at TC ≥ −2, otherwise hit | Stand at TC ≥ −1 (±1), otherwise hit | validated |
| 12 v 6 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ −1, otherwise hit | validated |
| 13 v 3 | stand ≥ -2 | Stand at TC ≥ −2, otherwise hit | Stand at TC ≥ −2, otherwise hit | validated |

### 6D S17 DAS LS (floor)

| Play | Published (6D S17) | Synthetic | Monte Carlo | Status |
|---|---|---|---|---|
| Insurance | insure ≥ +3 | Take insurance at TC ≥ +3, otherwise decline insurance | Take insurance at TC ≥ +3, otherwise decline insurance | validated |
| 16 v 10 | stand ≥ +0 | Surrender at TC ≥ −4, otherwise hit | Surrender at TC ≥ −3, otherwise hit | validated |
| 15 v 10 | stand ≥ +4, surrender ≥ +0 | Surrender at TC ≥ 0, otherwise hit | Surrender at TC ≥ 0, otherwise hit | validated |
| 10,10 v 5 | split ≥ +5 | Split at TC ≥ +5, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10,10 v 6 | split ≥ +4 | Split at TC ≥ +4, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10 v 10 | double ≥ +4 | Double at TC ≥ +4, otherwise hit | Double at TC ≥ +4, otherwise hit | validated |
| 12 v 3 | stand ≥ +2 | Stand at TC ≥ +2, otherwise hit | Stand at TC ≥ +2, otherwise hit | validated |
| 12 v 2 | stand ≥ +3 | Stand at TC ≥ +3, otherwise hit | Stand at TC ≥ +4 (±1), otherwise hit | validated |
| 11 v A | double ≥ +1 | Double at TC ≥ +1, otherwise hit | Double at TC ≥ +1, otherwise hit | validated |
| 9 v 2 | double ≥ +1 | Double at TC ≥ +1, otherwise hit | Double at TC ≥ +1, otherwise hit | validated |
| 10 v A | double ≥ +4 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +4 (±1), otherwise hit | validated |
| 9 v 7 | double ≥ +3 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +3 (±1), otherwise hit | validated |
| 16 v 9 | stand ≥ +5 | Surrender at TC ≥ −1, otherwise hit | Surrender at TC ≥ 0, otherwise hit | validated |
| 13 v 2 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ −1, otherwise hit | validated |
| 12 v 4 | stand ≥ +0 | Stand at TC ≥ 0, otherwise hit | Stand at TC ≥ 0, otherwise hit | validated |
| 12 v 5 | stand ≥ -2 | Stand at TC ≥ −2, otherwise hit | Stand at TC ≥ −1 (±1), otherwise hit | validated |
| 12 v 6 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ −1, otherwise hit | validated |
| 13 v 3 | stand ≥ -2 | Stand at TC ≥ −2, otherwise hit | Stand at TC ≥ −2, otherwise hit | validated |
| 14 v 10 | surrender ≥ +3 | Surrender at TC ≥ +3, otherwise hit | Surrender at TC ≥ +4 (±1), otherwise hit | validated |
| 15 v 9 | surrender ≥ +2 | Surrender at TC ≥ +2, otherwise hit | Surrender at TC ≥ +2, otherwise hit | validated |
| 15 v A | surrender ≥ +1 | Surrender at TC ≥ +2, otherwise hit | Surrender at TC ≥ +2 (±1), otherwise hit | validated |

### 6D H17 DAS NS (floor)

| Play | Published (6D S17) | Synthetic | Monte Carlo | Status |
|---|---|---|---|---|
| Insurance | insure ≥ +3 | Take insurance at TC ≥ +3, otherwise decline insurance | Take insurance at TC ≥ +3, otherwise decline insurance | validated |
| 16 v 10 | stand ≥ +0 | Stand at TC ≥ 0, otherwise hit | Stand at TC ≥ +1, otherwise hit | validated |
| 15 v 10 | stand ≥ +4, surrender ≥ +0 | Stand at TC ≥ +4, otherwise hit | Stand at TC ≥ +4, otherwise hit | validated |
| 10,10 v 5 | split ≥ +5 | Split at TC ≥ +5, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10,10 v 6 | split ≥ +4 | Split at TC ≥ +4, otherwise stand | Split at TC ≥ +4, otherwise stand | validated |
| 10 v 10 | double ≥ +4 | Double at TC ≥ +4, otherwise hit | Double at TC ≥ +4, otherwise hit | validated |
| 12 v 3 | stand ≥ +2 | Stand at TC ≥ +1, otherwise hit | Stand at TC ≥ +1, otherwise hit | validated |
| 12 v 2 | stand ≥ +3 | Stand at TC ≥ +3, otherwise hit | Stand at TC ≥ +3 (±1), otherwise hit | validated |
| 11 v A | double ≥ +1 | Double at TC ≥ −1, otherwise hit | Double at TC ≥ −1 (±1), otherwise hit | validated |
| 9 v 2 | double ≥ +1 | Double at TC ≥ +1, otherwise hit | Double at TC ≥ +1, otherwise hit | validated |
| 10 v A | double ≥ +4 | Double at TC ≥ +2, otherwise hit | Double at TC ≥ +3, otherwise hit | validated |
| 9 v 7 | double ≥ +3 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +4 (±1), otherwise hit | validated |
| 16 v 9 | stand ≥ +5 | Stand at TC ≥ +4, otherwise hit | Stand at TC ≥ +5, otherwise hit | validated |
| 13 v 2 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ −1, otherwise hit | validated |
| 12 v 4 | stand ≥ +0 | Stand at TC ≥ 0, otherwise hit | Stand at TC ≥ 0, otherwise hit | validated |
| 12 v 5 | stand ≥ -2 | Stand at TC ≥ −2, otherwise hit | Stand at TC ≥ −2, otherwise hit | validated |
| 12 v 6 | stand ≥ -1 | Stand at TC ≥ −4, otherwise hit | Stand at TC ≥ −4 (±1), otherwise hit | validated |
| 13 v 3 | stand ≥ -2 | Stand at TC ≥ −3, otherwise hit | Stand at TC ≥ −3 (±1), otherwise hit | validated |

### 6D H17 DAS LS (floor)

| Play | Published (6D S17) | Synthetic | Monte Carlo | Status |
|---|---|---|---|---|
| Insurance | insure ≥ +3 | Take insurance at TC ≥ +3, otherwise decline insurance | Take insurance at TC ≥ +3, otherwise decline insurance | validated |
| 16 v 10 | stand ≥ +0 | Surrender at TC ≥ −4, otherwise hit | Surrender at TC ≥ −3 (±1), otherwise hit | validated |
| 15 v 10 | stand ≥ +4, surrender ≥ +0 | Surrender at TC ≥ 0, otherwise hit | Surrender at TC ≥ 0, otherwise hit | validated |
| 10,10 v 5 | split ≥ +5 | Split at TC ≥ +5, otherwise stand | Split at TC ≥ +5, otherwise stand | validated |
| 10,10 v 6 | split ≥ +4 | Split at TC ≥ +4, otherwise stand | Split at TC ≥ +4, otherwise stand | validated |
| 10 v 10 | double ≥ +4 | Double at TC ≥ +4, otherwise hit | Double at TC ≥ +4, otherwise hit | validated |
| 12 v 3 | stand ≥ +2 | Stand at TC ≥ +1, otherwise hit | Stand at TC ≥ +1, otherwise hit | validated |
| 12 v 2 | stand ≥ +3 | Stand at TC ≥ +3, otherwise hit | Stand at TC ≥ +3 (±1), otherwise hit | validated |
| 11 v A | double ≥ +1 | Double at TC ≥ −1, otherwise hit | Double at TC ≥ −1 (±1), otherwise hit | validated |
| 9 v 2 | double ≥ +1 | Double at TC ≥ +1, otherwise hit | Double at TC ≥ +1, otherwise hit | validated |
| 10 v A | double ≥ +4 | Double at TC ≥ +2, otherwise hit | Double at TC ≥ +3, otherwise hit | validated |
| 9 v 7 | double ≥ +3 | Double at TC ≥ +3, otherwise hit | Double at TC ≥ +4 (±1), otherwise hit | validated |
| 16 v 9 | stand ≥ +5 | Surrender at TC ≥ −1, otherwise hit | Surrender at TC ≥ 0 (±1), otherwise hit | validated |
| 13 v 2 | stand ≥ -1 | Stand at TC ≥ −1, otherwise hit | Stand at TC ≥ −1, otherwise hit | validated |
| 12 v 4 | stand ≥ +0 | Stand at TC ≥ 0, otherwise hit | Stand at TC ≥ 0, otherwise hit | validated |
| 12 v 5 | stand ≥ -2 | Stand at TC ≥ −2, otherwise hit | Stand at TC ≥ −2, otherwise hit | validated |
| 12 v 6 | stand ≥ -1 | Stand at TC ≥ −4, otherwise hit | Stand at TC ≥ −4 (±1), otherwise hit | validated |
| 13 v 3 | stand ≥ -2 | Stand at TC ≥ −3, otherwise hit | Stand at TC ≥ −3 (±1), otherwise hit | validated |
| 14 v 10 | surrender ≥ +3 | Surrender at TC ≥ +3, otherwise hit | Surrender at TC ≥ +4 (±1), otherwise hit | validated |
| 15 v 9 | surrender ≥ +2 | Surrender at TC ≥ +2, otherwise hit | Surrender at TC ≥ +2, otherwise hit | validated |
| 15 v A | surrender ≥ +1 | Surrender at TC ≥ −1, otherwise hit | Surrender at TC ≥ −1, otherwise hit | validated |

### Three-card hands (diagnostic, floor)

- 2D S17 h15v10 NS: Stand at TC ≥ +4, otherwise hit. (6240 states)
- 2D S17 h15v10 LS: Surrender at TC ≥ 0, otherwise hit. (6240 states)
- 2D S17 h16v10 NS: Stand at TC ≥ 0 (±1), otherwise hit. (6880 states)
- 2D S17 h16v10 LS: Surrender at TC ≥ −4, otherwise hit. (6880 states)
- 2D H17 h15v10 NS: Stand at TC ≥ +4, otherwise hit. (7520 states)
- 2D H17 h15v10 LS: Surrender at TC ≥ 0, otherwise hit. (7520 states)
- 2D H17 h16v10 NS: Stand at TC ≥ −1, otherwise hit. (6880 states)
- 2D H17 h16v10 LS: Surrender at TC ≥ −4, otherwise hit. (6880 states)
- 6D S17 h15v10 NS: Stand at TC ≥ +4, otherwise hit. (6240 states)
- 6D S17 h15v10 LS: Surrender at TC ≥ 0, otherwise hit. (6240 states)
- 6D S17 h16v10 NS: Stand at TC ≥ 0, otherwise hit. (6240 states)
- 6D S17 h16v10 LS: Surrender at TC ≥ −3 (±1), otherwise hit. (6240 states)
- 6D H17 h15v10 NS: Stand at TC ≥ +4, otherwise hit. (6240 states)
- 6D H17 h15v10 LS: Surrender at TC ≥ 0, otherwise hit. (6240 states)
- 6D H17 h16v10 NS: Stand at TC ≥ 0, otherwise hit. (6240 states)
- 6D H17 h16v10 LS: Surrender at TC ≥ −4 (±1), otherwise hit. (6240 states)

Total Monte Carlo states: 444,800 across 92 jobs.

## 6. Remaining limitations

1. **Oracle EVs come from the same analyzer.** The Monte Carlo uses the finite-shoe analyzer as its EV oracle. That analyzer is independently validated against published composition-dependent EVs to six decimal places for stand, hit and double. Splits do not model resplitting, so split indices (10,10 v 5/6) are slightly conservative.
2. **Sampled states approximate real decision timing.** States are "first *k* cards dealt" with *k* uniform up to 70% penetration. That matches the composition of a dealt set exactly, but how often decisions occur at each depth depends on the number of players and the length of rounds. For the priority plays in section 4, depth bands agree within one true count.
3. **Two-card hands only.** Deviations are graded only for two-card, unsplit hands, 10,10 and insurance. Multi-card stiffs (for example three-card 16 v 10, whose index is 0 to −1) are graded by basic strategy at the table.
4. **No deviation EV is estimated.** Plays are graded right or wrong only. The ±1 labels mark crossings where the two plays are statistically indistinguishable; there both plays are accepted.
5. **Not every ruleset is tested.** Monte Carlo was run for 2 and 6 decks with H17 and S17. Four- and eight-deck sets remain experimental, and single deck is unsupported.
6. **Rounding conventions matter.** Each convention has its own validated buckets, and results can differ by one between conventions. Published indices assume their own conventions.
