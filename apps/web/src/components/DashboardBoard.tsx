"use client";

import { DashboardMonthCalendar } from "./DashboardMonthCalendar";
import { HouseholdPanel, type SelfStatus, type StatusRow } from "./HouseholdPanel";
import { TodayGlance } from "./TodayGlance";
import { WeatherPanel } from "./WeatherPanel";

export function DashboardBoard({
  whosHome,
  self,
  driveModuleEnabled = false,
  denseGlanceLayout = false,
}: {
  whosHome: StatusRow[];
  self: SelfStatus | null;
  driveModuleEnabled?: boolean;
  denseGlanceLayout?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div
        className={
          denseGlanceLayout
            ? "grid grid-cols-1 gap-6"
            : "grid gap-6 md:grid-cols-2 md:items-stretch"
        }
      >
        <TodayGlance driveModuleEnabled={driveModuleEnabled} />
        <DashboardMonthCalendar compact />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <WeatherPanel />
        <HouseholdPanel initial={whosHome} self={self} />
      </div>
    </div>
  );
}
