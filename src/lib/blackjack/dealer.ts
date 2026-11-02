import type { Card } from "./cards";
import { handValue } from "./hand";
import type { TableRules } from "./rules";

export function dealerShouldHit(cards: readonly Card[], rules: Pick<TableRules, "dealerHitsSoft17">): boolean {
  const v = handValue(cards);
  if (v.total < 17) return true;
  if (v.total === 17 && v.soft && rules.dealerHitsSoft17) return true;
  return false;
}
