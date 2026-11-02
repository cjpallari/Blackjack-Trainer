import { PageHeader } from "@/components/layout/app-shell";
import { SettingsPanel } from "@/components/settings/settings-panel";

export const metadata = { title: "Settings · BJ Trainer" };

export default function Page() {
  return (
    <>
      <PageHeader title="Settings" description="Table rules drive the strategy you are graded against. Counting and data preferences live here too." />
      <SettingsPanel />
    </>
  );
}
