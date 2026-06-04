import { AppShell } from "../../components/AppShell";
import { DashboardBoard } from "../../components/DashboardBoard";
import type { SelfStatus, StatusRow } from "../../components/HouseholdPanel";
import { apiFetch } from "../../lib/api";
import { Alert } from "../../components/ui";

export default async function DashboardPage() {
  let whosHome: StatusRow[] = [];
  let self: SelfStatus | null = null;
  let loadError: string | null = null;

  try {
    const [dashboard, profile] = await Promise.all([
      apiFetch<{ whosHome: StatusRow[] }>("/api/core/dashboard"),
      apiFetch<{
        shownLabel: string;
        homeStatusId: string | null;
        presence: "Home" | "Away";
        statusMessage: string | null;
        avatarUrl: string | null;
      }>("/api/core/profile"),
    ]);
    whosHome = dashboard.whosHome;
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
    <AppShell title="Dashboard" description="Household command center">
      {loadError ? (
        <Alert variant="error">
          {loadError}. <a href="/dashboard">Retry</a>
        </Alert>
      ) : (
        <DashboardBoard whosHome={whosHome} self={self} />
      )}
    </AppShell>
  );
}
