import { AppShell } from "../../components/AppShell";
import { HouseholdMembersPanel } from "../../components/HouseholdMembersPanel";
import { ProfileEditor } from "../../components/ProfileEditor";
import { apiFetch } from "../../lib/api";
import { loadErrorMessage } from "../../lib/load-error";
import { Alert } from "../../components/ui";

type HouseholdRole = "owner" | "admin" | "member" | "child" | "guest";

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

  return (
    <AppShell title="Profile" description="Name, presence, and preferences">
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/profile">Retry</a>
        </Alert>
      ) : (
        <div className="space-y-8">
          <ProfileEditor initial={profile} />
          <HouseholdMembersPanel canManage={profile.role === "owner" || profile.role === "admin"} />
        </div>
      )}
    </AppShell>
  );
}
