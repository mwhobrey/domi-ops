import { AccountSettingsNav } from "../../components/AccountSettingsNav";
import { AppShell } from "../../components/AppShell";
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
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load profile");
  }

  const canManage = canManageHousehold(profile.role);

  return (
    <AppShell title="Profile" description="Your name, presence, and notification preferences">
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/profile">Retry</a>
        </Alert>
      ) : (
        <>
          <AccountSettingsNav canManage={canManage} />
          <div className="mx-auto w-full max-w-2xl lg:max-w-4xl">
            <ProfileEditor
              initial={profile}
              calendarIntegration={calendarIntegration ?? undefined}
              modulesEnabled={modulesEnabled}
            />
          </div>
          <ScrollToTopFab className="bottom-[max(5rem,env(safe-area-inset-bottom))] lg:bottom-[max(1.5rem,env(safe-area-inset-bottom))]" />
        </>
      )}
    </AppShell>
  );
}
