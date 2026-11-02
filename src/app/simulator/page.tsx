import { PageHeader } from "@/components/layout/app-shell";
import { BlackjackTable } from "@/components/blackjack/table/blackjack-table";

export const metadata = { title: "Blackjack Simulator · BJ Trainer" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Blackjack Simulator"
        description="A full table dealt from one physical shoe until the cut card. Uses your table rules from Settings."
      />
      <BlackjackTable />
    </>
  );
}
