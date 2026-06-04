"use client";

import { DashboardMonthCalendar } from "./DashboardMonthCalendar";
import { HouseholdPanel, type SelfStatus, type StatusRow } from "./HouseholdPanel";
import { TodayGlance } from "./TodayGlance";
import { WeatherPanel } from "./WeatherPanel";

export function DashboardBoard({
  whosHome,
  self,
}: {
  whosHome: StatusRow[];
  self: SelfStatus | null;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
        <TodayGlance />
        <DashboardMonthCalendar compact />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <WeatherPanel />
        <HouseholdPanel initial={whosHome} self={self} />
      </div>
    </div>
  );
}
