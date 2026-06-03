import { AppShell } from "../../components/AppShell";
import { DashboardEditor } from "../../components/DashboardEditor";
import { apiFetch } from "../../lib/api";

export default async function DashboardPage() {
  let dashboard = {
    notice: "",
    whosHome: [] as { id: string; name: string; status: string }[],
  };
  try {
    dashboard = await apiFetch("/api/core/dashboard");
  } catch {
    /* empty */
  }

  return (
    <AppShell title="Dashboard">
      <DashboardEditor initialNotice={dashboard.notice} whosHome={dashboard.whosHome} />
    </AppShell>
  );
}
