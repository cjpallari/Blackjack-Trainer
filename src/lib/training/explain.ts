import { pointRankLabel, type PointRank } from "../blackjack/cards";
import type { PlayerAction, StrategyAdvice } from "../blackjack/strategy";
import type { StrategyTable } from "../blackjack/strategy-table";

export const ACTION_LABEL: Record<PlayerAction, string> = {
  hit: "Hit",
  stand: "Stand",
  double: "Double",
  split: "Split",
  surrender: "Surrender",
};

/**
 * Probability the dealer busts with this upcard (given no natural), derived
 * from the exact EV of standing on a hard 16: every non-bust dealer result
 * beats 16, so EV = P(bust) − (1 − P(bust)).
 */
export function dealerBustChance(table: StrategyTable, up: PointRank): number {
  return (table.hard[16][String(up)].stand + 1) / 2;
}

export function formatEv(ev: number): string {
  const s = (ev >= 0 ? "+" : "−") + Math.abs(ev).toFixed(3);
  return s;
}

/** Plain-language reasoning for the recommended play. Facts come from the EV table. */
export function explainAdvice(advice: StrategyAdvice, up: PointRank, table: StrategyTable): string {
  const upL = pointRankLabel(up) === "A" ? "an Ace" : `a ${pointRankLabel(up)}`;
  const bust = Math.round(dealerBustChance(table, up) * 100);
  const { best, category, total, evs } = advice;
  const second = (Object.entries(evs) as [PlayerAction, number][])
    .filter(([a]) => a !== best)
    .sort((a, b) => b[1] - a[1])[0];
  const margin = second ? evs[best]! - second[1] : 0;
  const vs = second ? ` ${ACTION_LABEL[best]} beats ${ACTION_LABEL[second[0]].toLowerCase()} by ${(margin * 100).toFixed(1)}% of your bet.` : "";

  let why: string;
  switch (best) {
    case "split":
      if (advice.row === "pair A") why = "Two hands starting with an Ace are far stronger than one soft 12.";
      else if (advice.row === "pair 8") why = "Hard 16 is the worst total; two hands starting from 8 lose much less.";
      else why = `Splitting turns a weak total into two hands that each start better against ${upL}.`;
      break;
    case "double":
      why =
        category === "soft"
          ? `Your soft ${total} can't bust with one card, and with ${upL} up the dealer busts about ${bust}% of the time, so getting more money out is worth it.`
          : evs.double! > 0
            ? `${total} is a strong starting total against ${upL}; you are the favourite, so doubling the bet raises your expected win.`
            : `${total} is a strong starting total against ${upL}; one card to a strong total is worth more than hitting freely.`;
      break;
    case "surrender":
      why = `Against ${upL} this hand is expected to lose more than half a bet however you play it, so giving up half is cheaper.`;
      break;
    case "stand":
      if (category !== "soft" && total >= 12 && total <= 16)
        why = `The dealer must draw to 17 with ${upL} up and busts about ${bust}% of the time. Hitting a stiff hand risks busting first.`;
      else if (total >= 17) why = `${total} is strong enough that another card is more likely to hurt than help.`;
      else why = `Standing gives the best result against ${upL}.`;
      break;
    case "hit":
      if (category !== "soft" && total >= 12)
        why = `With ${upL} up the dealer busts only about ${bust}% of the time and usually makes 17+, so standing on ${total} loses too often.`;
      else if (category === "soft") why = `A soft hand can't bust with one card, and soft ${total} is too weak to stand on against ${upL}.`;
      else why = `${total} can't bust with one card, and it is not strong enough to double against ${upL}.`;
      break;
  }
  return why + vs;
}
