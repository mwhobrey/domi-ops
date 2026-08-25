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
  role = null,
  onboarding = null,
}: {
  whosHome: StatusRow[];
  self: SelfStatus | null;
  schoolModuleEnabled?: boolean;
  healthModuleEnabled?: boolean;
  role?: string | null;
  onboarding?: OnboardingState | null;
}) {
  return (
    <div className="space-y-6">
      {role && <OnboardingChecklist role={role} initialState={onboarding} />}
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
