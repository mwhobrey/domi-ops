"use client";

import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { googleDocsConnectUrl } from "../lib/auth-links";
import { apiClient } from "../lib/client-api";
import { AnchorButton } from "./ui";

export function ProfileGoogleDocsConnect() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void apiClient
      .get<{ connected: boolean }>("/api/core/weekly-reports/google-docs/status")
      .then((data) => {
        if (!cancelled) setConnected(data.connected);
      })
      .catch(() => {
        if (!cancelled) setConnected(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]"
          aria-hidden
        >
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {loading
              ? "Checking Google Docs…"
              : connected
                ? "Google Docs export connected"
                : "Google Docs export not connected"}
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            Export weekly reports to Google Docs or save files to your Google Drive.
          </p>
        </div>
      </div>
      <AnchorButton href={googleDocsConnectUrl()} variant="secondary" size="sm">
        {connected ? "Reconnect" : "Connect Google Docs"}
      </AnchorButton>
    </div>
  );
}
