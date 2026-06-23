"use client";

import { SectionHeader } from "./ui";
import { WeeklyReportPanel } from "./WeeklyReportPanel";
import { ShoppingTripReportSection } from "./reports/ShoppingTripReportSection";

export function ShoppingReportsClient({ driveEnabled = true }: { driveEnabled?: boolean }) {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <SectionHeader title="Weekly schedule" />
        <WeeklyReportPanel module="shopping" driveEnabled={driveEnabled} />
      </section>
      <section className="space-y-4">
        <SectionHeader title="Trip history" />
        <ShoppingTripReportSection driveEnabled={driveEnabled} />
      </section>
    </div>
  );
}
