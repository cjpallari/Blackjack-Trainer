import { PageHeader } from "@/components/layout/app-shell";
import { Dashboard } from "@/components/dashboard/dashboard";

export default function Page() {
  return (
    <>
      <PageHeader title="Dashboard" description="Your training progress. Decision accuracy, counting accuracy and expected value are tracked separately." />
      <Dashboard />
    </>
  );
}
