import { AppShell } from "../../components/AppShell";
import { DashboardBoard } from "../../components/DashboardBoard";
import type { SelfStatus, StatusRow } from "../../components/HouseholdPanel";
import type { OnboardingState } from "../../components/OnboardingChecklist";
import { apiFetch } from "../../lib/api";
import { Alert } from "../../components/ui";

export default async function DashboardPage() {
  let whosHome: StatusRow[] = [];
  let self: SelfStatus | null = null;
  let loadError: string | null = null;

  let schoolModuleEnabled = false;
  let healthModuleEnabled = false;
  let role: string | null = null;
  let onboarding: OnboardingState | null = null;

  try {
    const [dashboard, profile, session, onboardingRes] = await Promise.all([
      apiFetch<{ whosHome: StatusRow[] }>("/api/core/dashboard"),
      apiFetch<{
        shownLabel: string;
        homeStatusId: string | null;
        presence: "Home" | "Away";
        statusMessage: string | null;
        avatarUrl: string | null;
      }>("/api/core/profile"),
      apiFetch<{
        modulesEnabled?: string[];
        user?: { memberId: string; role: string };
      }>("/auth/session").catch(() => ({
        modulesEnabled: [] as string[],
        user: undefined,
      })),
      apiFetch<OnboardingState>("/api/core/onboarding").catch(() => null),
    ]);
    whosHome = dashboard.whosHome;
    schoolModuleEnabled = (session.modulesEnabled ?? []).includes("school");
    healthModuleEnabled = (session.modulesEnabled ?? []).includes("health");
    role = session.user?.role ?? null;
    onboarding = onboardingRes;
    if (profile.homeStatusId) {
      self = {
        homeStatusId: profile.homeStatusId,
        name: profile.shownLabel,
        presence: profile.presence,
        statusMessage: profile.statusMessage,
        avatarUrl: profile.avatarUrl,
      };
    }
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load dashboard";
  }

  return (
    <AppShell title="Dashboard">
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/dashboard">Retry</a>
        </Alert>
      ) : (
        <DashboardBoard
          whosHome={whosHome}
          self={self}
          schoolModuleEnabled={schoolModuleEnabled}
          healthModuleEnabled={healthModuleEnabled}
          role={role}
          onboarding={onboarding}
        />
      )}
    </AppShell>
  );
}
