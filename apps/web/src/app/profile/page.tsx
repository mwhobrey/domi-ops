import { AccountSettingsNav } from "../../components/AccountSettingsNav";
import { AppShell } from "../../components/AppShell";
import { FeedbackCard } from "../../components/FeedbackCard";
import { GlanceConfigCard, type GlanceTileOption } from "../../components/GlanceConfigCard";
import { OnboardingReplayCard } from "../../components/OnboardingReplayCard";
import { PendingTourRunner } from "../../components/PendingTourRunner";
import { ProfileEditor } from "../../components/ProfileEditor";
import { ScrollToTopFab } from "../../components/ScrollToTopFab";
import { apiFetch } from "../../lib/api";
import { canManageHousehold, type HouseholdRole } from "../../lib/household-roles";
import { loadErrorMessage } from "../../lib/load-error";
import { Alert } from "../../components/ui";

export default async function ProfilePage() {
  let profile = {
    email: null as string | null,
    username: null as string | null,
    role: "member" as HouseholdRole,
    name: null as string | null,
    shownLabel: "Member",
    memberId: "",
    homeStatusId: null as string | null,
    presence: "Away" as const,
    statusMessage: null as string | null,
    temperatureUnit: "fahrenheit" as const,
    pushNoticesEnabled: true,
    pushCalendarRemindersEnabled: true,
    pushChoresRemindersEnabled: true,
    pushExpenseBudgetAlertsEnabled: true,
    pushSchoolRemindersEnabled: true,
    pushShoppingRemindersEnabled: true,
    pushHealthRemindersEnabled: true,
    calendarOverlaySchoolEnabled: true,
    calendarOverlayHealthEventsEnabled: true,
    calendarOverlayHealthMedsEnabled: true,
    pushSubscribed: false,
    pushAvailable: false,
    avatarUrl: null as string | null,
  };
  let calendarIntegration: {
    oauthConfigured: boolean;
    defaultSyncMode: string;
    connections: { id: string; lastSyncAt: string | null }[];
  } | null = null;
  let modulesEnabled: string[] = [];
  let glanceConfig: string[] | null = null;
  let loadError: string | null = null;
  try {
    profile = await apiFetch("/api/core/profile");
    try {
      const session = await apiFetch<{ modulesEnabled?: string[] }>("/auth/session");
      modulesEnabled = session.modulesEnabled ?? [];
    } catch {
      /* session optional */
    }
    try {
      const status = await apiFetch<{
        oauthConfigured: boolean;
        defaultSyncMode: string;
      }>("/api/calendar/status");
      const connRes = await apiFetch<{
        connections: { id: string; lastSyncAt: string | null }[];
      }>("/api/calendar/connections");
      calendarIntegration = {
        oauthConfigured: status.oauthConfigured,
        defaultSyncMode: status.defaultSyncMode,
        connections: connRes.connections,
      };
    } catch {
      /* calendar module optional */
    }
    try {
      const glance = await apiFetch<{ tiles: string[] | null }>("/api/core/glance-config");
      glanceConfig = glance.tiles;
    } catch {
      /* falls back to default order */
    }
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load profile");
  }

  const canManage = canManageHousehold(profile.role);

  // Chores + shopping are "core" — always available, no toggle. School/health only show up as
  // configurable dashboard tiles when their module is actually on, same gate TodayGlance itself
  // uses — keeps this list from ever offering a tile the household can't currently see anyway.
  const availableGlanceTiles: GlanceTileOption[] = [
    { key: "chores", label: "Chores" },
    { key: "shopping", label: "Shopping" },
    { key: "notes", label: "Notes" },
    { key: "expenses", label: "Expenses" },
    ...(modulesEnabled.includes("school") ? [{ key: "school", label: "School" }] : []),
    ...(modulesEnabled.includes("health") ? [{ key: "health", label: "Health" }] : []),
    ...(modulesEnabled.includes("drive") ? [{ key: "drive", label: "Drive" }] : []),
    ...(modulesEnabled.includes("calendar_sync") ? [{ key: "calendar", label: "Calendar" }] : []),
  ];

  return (
    <AppShell title="Profile" description="Your name, presence, and notification preferences">
      <PendingTourRunner />
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/profile">Retry</a>
        </Alert>
      ) : (
        <>
          <AccountSettingsNav canManage={canManage} />
          <div className="mx-auto w-full max-w-2xl space-y-8 lg:max-w-4xl">
            <ProfileEditor
              initial={profile}
              calendarIntegration={calendarIntegration ?? undefined}
              modulesEnabled={modulesEnabled}
            />
            <GlanceConfigCard available={availableGlanceTiles} initialConfig={glanceConfig} />
            <OnboardingReplayCard />
            <FeedbackCard
              endpoint={process.env.TELEMETRY_ENDPOINT ?? "https://app.domi-ops.com/api/telemetry"}
              deploymentMode={process.env.DEPLOYMENT_MODE ?? "single"}
            />
          </div>
          <ScrollToTopFab className="bottom-[max(5rem,env(safe-area-inset-bottom))] lg:bottom-[max(1.5rem,env(safe-area-inset-bottom))]" />
        </>
      )}
    </AppShell>
  );
}
