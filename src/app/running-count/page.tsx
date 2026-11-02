import { PageHeader } from "@/components/layout/app-shell";
import { RunningCountTrainer } from "@/components/training/running-count-trainer";

export const metadata = { title: "Running Count · BJ Trainer" };

export default function Page() {
  return (
    <>
      <PageHeader title="Running Count" description="Hi-Lo running count drills: flashcards, sequences, simultaneous cards, full-deck countdowns and timed streams." />
      <RunningCountTrainer />
    </>
  );
}
