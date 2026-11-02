import { PageHeader } from "@/components/layout/app-shell";
import { TrueCountTrainer } from "@/components/training/true-count-trainer";

export const metadata = { title: "True Count · BJ Trainer" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="True Count"
        description="Convert running count to true count (running count ÷ decks remaining), and estimate decks remaining from the discard tray."
      />
      <TrueCountTrainer />
    </>
  );
}
