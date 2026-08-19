import { redirect } from "next/navigation";
import { AccountSettingsNav } from "../../components/AccountSettingsNav";
import { AppShell } from "../../components/AppShell";
import {
  HouseholdIntegrationsPanel,
  type HouseholdIntegrationsStatus,
} from "../../components/HouseholdIntegrationsPanel";
import { ScrollToTopFab } from "../../components/ScrollToTopFab";
import { HouseholdMembersPanel } from "../../components/HouseholdMembersPanel";
import { HouseholdSettingsEditor } from "../../components/HouseholdSettingsEditor";
import { SubscriptionPlanCard } from "../../components/SubscriptionPlanCard";
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
    availableModules: [] as string[],
    modulesEntitled: null as string[] | null,
    subscriptionStatus: null as "trialing" | "active" | "past_due" | "canceled" | null,
    trialEndsAt: null as string | null,
  };
  let integrations: HouseholdIntegrationsStatus | null = null;
  let loadError: string | null = null;

  try {
    profile = await apiFetch<{ role: HouseholdRole }>("/api/core/profile");
    if (!canManageHousehold(profile.role)) {
      redirect("/profile");
    }
    [household, integrations] = await Promise.all([
      apiFetch<typeof household>("/api/core/household/settings"),
      apiFetch<HouseholdIntegrationsStatus>("/api/core/household/integrations"),
    ]);
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
          <div className="mx-auto w-full max-w-2xl space-y-8 lg:max-w-4xl">
            {household.subscriptionStatus ? (
              <SubscriptionPlanCard
                subscriptionStatus={household.subscriptionStatus}
                trialEndsAt={household.trialEndsAt}
              />
            ) : null}
            <HouseholdSettingsEditor initial={household} />
            <HouseholdMembersPanel canManage actorRole={profile.role} />
            {integrations ? <HouseholdIntegrationsPanel status={integrations} /> : null}
          </div>
          <ScrollToTopFab />
        </>
      )}
    </AppShell>
  );
}
