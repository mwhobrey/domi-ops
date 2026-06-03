import { AppShell } from "../../components/AppShell";
import { DashboardBoard } from "../../components/DashboardBoard";
import { apiFetch } from "../../lib/api";
import { Alert } from "../../components/ui";

export default async function DashboardPage() {
  let notice = "";
  let whosHome: { id: string; name: string; status: string }[] = [];
  let loadError: string | null = null;

  try {
    const dashboard = await apiFetch<{
      notice: string;
      whosHome: { id: string; name: string; status: string }[];
    }>("/api/core/dashboard");
    notice = dashboard.notice;
    whosHome = dashboard.whosHome;
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
        <DashboardBoard notice={notice} whosHome={whosHome} />
      )}
    </AppShell>
  );
}
