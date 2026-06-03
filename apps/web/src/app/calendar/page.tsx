import { AppShell } from "../../components/AppShell";
import { CalendarPageClient } from "../../components/CalendarPageClient";
import { apiFetch } from "../../lib/api";
import { loadErrorMessage } from "../../lib/load-error";
import { Alert } from "../../components/ui";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  let status = { enabled: false, oauthConfigured: false, defaultSyncMode: "import_only" };
  let connections: { id: string; lastSyncAt: string | null }[] = [];
  let loadError: string | null = null;

  try {
    status = await apiFetch("/api/calendar/status");
    const connRes = await apiFetch<{ connections: typeof connections }>("/api/calendar/connections");
    connections = connRes.connections;
  } catch (e) {
    loadError = loadErrorMessage(e, "Calendar service unavailable");
  }

  return (
    <AppShell
      title="Calendar"
      description="Household calendar — local events and Google sync"
    >
      {loadError && (
        <Alert variant="info" className="mb-4">
          {loadError}. Connection settings may be incomplete — events still load below.
        </Alert>
      )}
      <CalendarPageClient
        oauthConfigured={status.oauthConfigured}
        defaultSyncMode={status.defaultSyncMode}
        initialConnections={connections}
        connectedBanner={Boolean(params.connected)}
        errorBanner={params.error}
      />
    </AppShell>
  );
}
