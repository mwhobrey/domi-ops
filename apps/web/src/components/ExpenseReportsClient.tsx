"use client";

import { SectionHeader } from "./ui";
import { WeeklyReportPanel } from "./WeeklyReportPanel";
import { ExpenseMonthlyReportSection } from "./reports/ExpenseMonthlyReportSection";

export function ExpenseReportsClient({ driveEnabled = true }: { driveEnabled?: boolean }) {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionHeader title="Weekly schedule" />
        <WeeklyReportPanel module="expenses" driveEnabled={driveEnabled} />
      </section>
      <section className="space-y-4">
        <SectionHeader title="Monthly spending" />
        <ExpenseMonthlyReportSection driveEnabled={driveEnabled} />
      </section>
    </div>
  );
}
