"use client";

import { DashboardMonthCalendar } from "./DashboardMonthCalendar";
import { HouseholdPanel, type SelfStatus, type StatusRow } from "./HouseholdPanel";
import { TodayAgenda } from "./TodayAgenda";
import { TodayGlance } from "./TodayGlance";
import { WeatherPanel } from "./WeatherPanel";

export function DashboardBoard({
  whosHome,
  self,
  schoolModuleEnabled = false,
  healthModuleEnabled = false,
}: {
  whosHome: StatusRow[];
  self: SelfStatus | null;
  schoolModuleEnabled?: boolean;
  healthModuleEnabled?: boolean;
}) {
  return (
    <div className="space-y-6">
      <TodayGlance
        schoolModuleEnabled={schoolModuleEnabled}
        healthModuleEnabled={healthModuleEnabled}
      />
      <div className="grid gap-6 md:grid-cols-2 md:items-stretch">
        <TodayAgenda />
        <WeatherPanel compact />
      </div>
      <HouseholdPanel initial={whosHome} self={self} />
      <DashboardMonthCalendar compact />
    </div>
  );
}
