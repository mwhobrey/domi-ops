import { AppShell } from "../../components/AppShell";
import { DashboardBoard } from "../../components/DashboardBoard";
import type { SelfStatus, StatusRow } from "../../components/HouseholdPanel";
import { apiFetch } from "../../lib/api";
import { Alert } from "../../components/ui";

export default async function DashboardPage() {
  let whosHome: StatusRow[] = [];
  let self: SelfStatus | null = null;
  let loadError: string | null = null;

  let driveModuleEnabled = false;
  let schoolModuleEnabled = false;

  try {
    const [dashboard, profile, session] = await Promise.all([
      apiFetch<{ whosHome: StatusRow[] }>("/api/core/dashboard"),
      apiFetch<{
        shownLabel: string;
        homeStatusId: string | null;
        presence: "Home" | "Away";
        statusMessage: string | null;
        avatarUrl: string | null;
      }>("/api/core/profile"),
      apiFetch<{ modulesEnabled?: string[] }>("/auth/session").catch(() => ({
        modulesEnabled: [] as string[],
      })),
    ]);
    whosHome = dashboard.whosHome;
    driveModuleEnabled = (session.modulesEnabled ?? []).includes("drive");
    schoolModuleEnabled = (session.modulesEnabled ?? []).includes("school");
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
          driveModuleEnabled={driveModuleEnabled}
          denseGlanceLayout={schoolModuleEnabled && driveModuleEnabled}
        />
      )}
    </AppShell>
  );
}
