/**
 * The pre-bet observation from the table view (what the player can see),
 * equivalent to sim/simulate.ts preBetObservation(state) by construction and
 * by test. Used by the betting trainer at the table.
 */
import { minimumCardsForRound } from "../blackjack/engine";
import type { TableView } from "../blackjack/table-view";
import type { PreBetObservation } from "./ramp";

export function preBetFromView(view: TableView, bankroll: number): PreBetObservation {
  const full = view.shoe.totalCards;
  const freshShoe = view.roundNumber === 0 || view.shoe.cutCardOut || view.shoe.cardsInShoe < minimumCardsForRound(view.seats.length);
  if (freshShoe) return { runningCount: 0, cardsInShoe: full, bankroll };
  return { runningCount: view.count.runningCount, cardsInShoe: view.shoe.cardsInShoe, bankroll };
}
