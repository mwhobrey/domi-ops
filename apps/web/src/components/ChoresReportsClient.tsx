"use client";

import { SectionHeader } from "./ui";
import { WeeklyReportPanel } from "./WeeklyReportPanel";
import { ChoresCompletionReportSection } from "./reports/ChoresCompletionReportSection";

export function ChoresReportsClient({ driveEnabled = true }: { driveEnabled?: boolean }) {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionHeader title="Weekly schedule" />
        <WeeklyReportPanel module="chores" driveEnabled={driveEnabled} />
      </section>
      <section className="space-y-4">
        <SectionHeader title="Completion history" />
        <ChoresCompletionReportSection driveEnabled={driveEnabled} />
      </section>
    </div>
  );
}
