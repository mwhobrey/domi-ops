import { AppShell } from "../../components/AppShell";
import { ProfileEditor } from "../../components/ProfileEditor";
import { apiFetch } from "../../lib/api";
import { loadErrorMessage } from "../../lib/load-error";
import { Alert } from "../../components/ui";

export default async function ProfilePage() {
  let profile = {
    email: "",
    name: null as string | null,
    nickname: null as string | null,
    publicLabel: "name" as const,
    shownLabel: "Member",
    memberId: "",
    homeStatusId: null as string | null,
    presence: "Away" as const,
    statusMessage: null as string | null,
    temperatureUnit: "fahrenheit" as const,
    pushNoticesEnabled: true,
    pushCalendarRemindersEnabled: true,
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
        <ProfileEditor initial={profile} />
      )}
    </AppShell>
  );
}
