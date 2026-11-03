import { PageHeader } from "@/components/layout/app-shell";
import { BettingLab } from "@/components/betting/betting-lab";

export const metadata = { title: "Betting & Bankroll · BJ Trainer" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Betting & Bankroll"
        description="Simulate betting ramps on real shuffled shoes: expected value with confidence intervals, spread comparisons, risk of ruin and penetration. Nothing runs until you press Run."
      />
      <BettingLab />
    </>
  );
}
