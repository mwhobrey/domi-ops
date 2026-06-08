import { AccountSettingsNav } from "../../components/AccountSettingsNav";
import { AppShell } from "../../components/AppShell";
import { ProfileEditor } from "../../components/ProfileEditor";
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
    pushSubscribed: false,
    pushAvailable: false,
    avatarUrl: null as string | null,
  };
  let loadError: string | null = null;
  try {
    profile = await apiFetch("/api/core/profile");
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
          <div className="mx-auto max-w-2xl">
            <ProfileEditor initial={profile} canManageHousehold={canManage} />
          </div>
        </>
      )}
    </AppShell>
  );
}
