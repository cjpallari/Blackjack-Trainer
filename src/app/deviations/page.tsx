import { PageHeader } from "@/components/layout/app-shell";
import { DeviationTrainer } from "@/components/training/deviation-trainer";

export const metadata = { title: "Deviations · BJ Trainer" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Deviations"
        description="Hi-Lo index plays (Illustrious 18 and Fab 4): when the true count says to depart from basic strategy. Indices are computed and validated for your rules."
      />
      <DeviationTrainer />
    </>
  );
}
