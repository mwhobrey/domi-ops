"use client";

import { Calendar } from "lucide-react";
import { googleCalendarConnectUrl } from "../lib/auth-links";
import { AnchorButton, LinkButton } from "./ui";

export function ProfileCalendarConnect({
  oauthConfigured,
  defaultSyncMode,
  connections,
}: {
  oauthConfigured: boolean;
  defaultSyncMode: string;
  connections: { id: string; lastSyncAt: string | null }[];
}) {
  const connected = connections.length > 0;
  const lastSync = connections[0]?.lastSyncAt;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]"
          aria-hidden
        >
          <Calendar className="h-4 w-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {connected ? "Google Calendar connected" : "Google Calendar not connected"}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            Sync mode: {defaultSyncMode.replace(/_/g, " ")}
            {lastSync ? ` · Last sync ${new Date(lastSync).toLocaleString()}` : null}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
        {oauthConfigured ? (
          <AnchorButton href={googleCalendarConnectUrl()} variant="secondary" size="sm">
            {connected ? "Reconnect" : "Connect Google"}
          </AnchorButton>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">OAuth not configured on this server.</p>
        )}
        <LinkButton href="/calendar" variant="ghost" size="sm">
          Calendar settings
        </LinkButton>
      </div>
    </div>
  );
}
