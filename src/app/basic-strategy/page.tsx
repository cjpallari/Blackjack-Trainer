import { PageHeader } from "@/components/layout/app-shell";
import { BasicStrategyTrainer } from "@/components/training/basic-strategy-trainer";

export const metadata = { title: "Basic Strategy · BJ Trainer" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Basic Strategy"
        description="Make the optimal play for each hand. Decisions are graded against basic strategy for your configured table rules."
      />
      <BasicStrategyTrainer />
    </>
  );
}
