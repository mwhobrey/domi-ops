"use client";

import { useState } from "react";
import { apiClient } from "../lib/client-api";
import { googleCalendarConnectUrl } from "../lib/auth-links";
import { Alert, Button, Card, CardBody } from "./ui";

export function CalendarConnectCard({
  oauthConfigured,
  defaultSyncMode,
  connections,
}: {
  oauthConfigured: boolean;
  defaultSyncMode: string;
  connections: { id: string; lastSyncAt: string | null }[];
}) {
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const connected = connections.length > 0;

  async function syncNow() {
    setSyncing(true);
    setMsg(null);
    try {
      await apiClient.post("/api/calendar/sync");
      setMsg("Sync queued — refresh in a moment.");
    } catch {
      setMsg("Connect Google Calendar before syncing.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardBody className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-medium">{connected ? "Google Calendar connected" : "Not connected"}</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Mode: {defaultSyncMode}
            {connections[0]?.lastSyncAt &&
              ` · Last sync ${new Date(connections[0].lastSyncAt).toLocaleString()}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {oauthConfigured && (
            <a href={googleCalendarConnectUrl()}>
              <Button variant="secondary" type="button">
                {connected ? "Reconnect" : "Connect Google"}
              </Button>
            </a>
          )}
          <Button variant="primary" loading={syncing} disabled={!connected} onClick={syncNow}>
            Sync now
          </Button>
        </div>
      </CardBody>
      {msg && (
        <div className="px-5 pb-4">
          <Alert variant="info">{msg}</Alert>
        </div>
      )}
    </Card>
  );
}
