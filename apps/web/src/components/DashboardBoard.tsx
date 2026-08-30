"use client";

import { DashboardMonthCalendar } from "./DashboardMonthCalendar";
import { HouseholdPanel, type SelfStatus, type StatusRow } from "./HouseholdPanel";
import { OnboardingChecklist, type OnboardingState } from "./OnboardingChecklist";
import { TodayAgenda } from "./TodayAgenda";
import { TodayGlance } from "./TodayGlance";
import { WeatherPanel } from "./WeatherPanel";

export function DashboardBoard({
  whosHome,
  self,
  schoolModuleEnabled = false,
  healthModuleEnabled = false,
  driveModuleEnabled = false,
  calendarModuleEnabled = false,
  role = null,
  onboarding = null,
  glanceConfig = null,
}: {
  whosHome: StatusRow[];
  self: SelfStatus | null;
  schoolModuleEnabled?: boolean;
  healthModuleEnabled?: boolean;
  driveModuleEnabled?: boolean;
  calendarModuleEnabled?: boolean;
  role?: string | null;
  onboarding?: OnboardingState | null;
  glanceConfig?: string[] | null;
}) {
  return (
    <div className="space-y-6">
      {role && <OnboardingChecklist role={role} initialState={onboarding} />}
      <TodayGlance
        schoolModuleEnabled={schoolModuleEnabled}
        healthModuleEnabled={healthModuleEnabled}
        driveModuleEnabled={driveModuleEnabled}
        calendarModuleEnabled={calendarModuleEnabled}
        glanceConfig={glanceConfig}
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
