import { AppShell } from "../../components/AppShell";
import { CalendarPageClient } from "../../components/CalendarPageClient";
import { PendingTourRunner } from "../../components/PendingTourRunner";
import { apiFetch } from "../../lib/api";
import { oauthFailureHint } from "../../lib/oauth-dev-hint";
import { loadErrorMessage } from "../../lib/load-error";
import { Alert } from "../../components/ui";

const publicAppUrl = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; import?: string }>;
}) {
  const params = await searchParams;
  let status = { enabled: false, oauthConfigured: false, defaultSyncMode: "import_only" };
  let connections: {
    id: string;
    syncMode: "import_only" | "manual" | "bidirectional";
    lastSyncAt: string | null;
  }[] = [];
  let loadError: string | null = null;

  try {
    status = await apiFetch("/api/calendar/status");
    const connRes = await apiFetch<{ connections: typeof connections }>("/api/calendar/connections");
    connections = connRes.connections;
  } catch (e) {
    loadError = loadErrorMessage(e, "Calendar service unavailable");
  }

  return (
    <AppShell title="Calendar">
      <PendingTourRunner />
      {loadError && (
        <Alert variant="info" className="mb-4">
          {loadError}. Connection settings may be incomplete — events still load below.
        </Alert>
      )}
      <CalendarPageClient
        oauthConfigured={status.oauthConfigured}
        defaultSyncMode={status.defaultSyncMode}
        initialConnections={connections}
        openImportWizard={Boolean(params.import) || Boolean(params.connected)}
        publicAppUrl={publicAppUrl}
        errorBanner={params.error}
        oauthFailureMessage={
          params.error === "oauth"
            ? oauthFailureHint(publicAppUrl)
            : params.error === "no_refresh"
              ? "Google did not return a refresh token. Disconnect the app in your Google Account → Third-party access, then connect again with consent."
              : undefined
        }
      />
    </AppShell>
  );
}
