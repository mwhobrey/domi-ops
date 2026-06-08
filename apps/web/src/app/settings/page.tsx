import { redirect } from "next/navigation";
import { AccountSettingsNav } from "../../components/AccountSettingsNav";
import { AppShell } from "../../components/AppShell";
import { HouseholdMembersPanel } from "../../components/HouseholdMembersPanel";
import { HouseholdSettingsEditor } from "../../components/HouseholdSettingsEditor";
import { apiFetch } from "../../lib/api";
import { canManageHousehold, type HouseholdRole } from "../../lib/household-roles";
import { loadErrorMessage } from "../../lib/load-error";
import { Alert } from "../../components/ui";

export default async function SettingsPage() {
  let profile = {
    role: "member" as HouseholdRole,
  };
  let household = {
    name: "Household",
    slug: null as string | null,
    timezone: "UTC",
    modulesEnabled: [] as string[],
  };
  let loadError: string | null = null;

  try {
    profile = await apiFetch<{ role: HouseholdRole }>("/api/core/profile");
    if (!canManageHousehold(profile.role)) {
      redirect("/profile");
    }
    household = await apiFetch<typeof household>("/api/core/household/settings");
  } catch (e) {
    loadError = loadErrorMessage(e, "Could not load household settings");
  }

  return (
    <AppShell
      title="Household settings"
      description="Name, timezone, and members for everyone in your home"
    >
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/settings">Retry</a>
        </Alert>
      ) : (
        <>
          <AccountSettingsNav canManage />
          <div className="mx-auto max-w-2xl space-y-8">
            <HouseholdSettingsEditor initial={household} />
            <HouseholdMembersPanel canManage />
          </div>
        </>
      )}
    </AppShell>
  );
}
