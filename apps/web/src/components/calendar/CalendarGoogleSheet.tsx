"use client";

import { useCallback, useEffect, useState } from "react";
import { Calendar, ChevronDown, RefreshCw } from "lucide-react";
import { apiClient } from "../../lib/client-api";
import { googleCalendarConnectUrl } from "../../lib/auth-links";
import { cn } from "../../lib/cn";
import { useCalendarSyncStatus } from "../../lib/use-calendar-sync-status";
import { CalendarCategoriesPanel } from "./CalendarCategoriesPanel";
import { CalendarLanesPanel } from "./CalendarLanesPanel";
import { CalendarSyncProgress } from "./CalendarSyncProgress";
import { Alert, AnchorButton, Button, Select, Sheet } from "../ui";

export type CalendarConnectionSummary = {
  id: string;
  syncMode: "import_only" | "manual" | "bidirectional";
  lastSyncAt: string | null;
  connectedAt?: string;
  syncRunStatus?: string;
};

const SYNC_MODE_SHORT: Record<CalendarConnectionSummary["syncMode"], string> = {
  import_only: "Import only",
  manual: "Manual pull",
  bidirectional: "Bidirectional",
};

const SYNC_MODE_HELP: Record<CalendarConnectionSummary["syncMode"], string> = {
  import_only: "Edits stay in whome; Google is the source on sync.",
  manual: "Pull from Google when you tap Sync now.",
  bidirectional: "Grid edits push back to Google (requires worker).",
};

function SettingsSection({
  title,
  description,
  defaultOpen,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]/30"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold">{title}</span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-4 border-t border-[var(--color-border)]/60 px-4 pb-4 pt-4">
        {description ? (
          <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">{description}</p>
        ) : null}
        {children}
      </div>
    </details>
  );
}

export function CalendarGoogleSheet({
  open,
  onClose,
  oauthConfigured,
  defaultSyncMode,
  initialConnections,
  onOpenImport,
  publicAppUrl: _publicAppUrl = process.env.NEXT_PUBLIC_PUBLIC_APP_URL ?? "http://localhost:3000",
  oauthFailureMessage,
}: {
  open: boolean;
  onClose: () => void;
  oauthConfigured: boolean;
  defaultSyncMode: string;
  initialConnections: CalendarConnectionSummary[];
  onOpenImport: () => void;
  publicAppUrl?: string;
  oauthFailureMessage?: string;
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; variant: "info" | "error" } | null>(
    null,
  );
  const { status: syncStatus, refresh: refreshSync, isActive } = useCalendarSyncStatus(open);

  useEffect(() => {
    setConnections(initialConnections);
  }, [initialConnections]);

  const connected = connections.length > 0;
  const conn = connections[0];
  const lastSync = conn?.lastSyncAt;
  const syncMode = conn?.syncMode ?? (defaultSyncMode as CalendarConnectionSummary["syncMode"]);

  const loadConnections = useCallback(async () => {
    try {
      const res = await apiClient.get<{ connections: CalendarConnectionSummary[] }>(
        "/api/calendar/connections",
      );
      setConnections(res.connections);
    } catch {
      /* keep prior */
    }
  }, []);

  useEffect(() => {
    if (!open || !connected) return;
    void loadConnections();
  }, [open, connected, loadConnections]);

  function openImportWizard() {
    onClose();
    onOpenImport();
  }

  async function syncNow() {
    setSyncing(true);
    setFeedback(null);
    try {
      await apiClient.post("/api/calendar/sync");
      void refreshSync();
      setFeedback({ text: "Sync queued.", variant: "info" });
    } catch {
      setFeedback({ text: "Connect Google Calendar before syncing.", variant: "error" });
    } finally {
      setSyncing(false);
    }
  }

  async function refreshSources() {
    setRefreshing(true);
    setFeedback(null);
    try {
      const res = await apiClient.post<{ added: number }>("/api/calendar/import/refresh-sources");
      setFeedback({
        text:
          res.added > 0
            ? `Found ${res.added} new Google calendar${res.added === 1 ? "" : "s"}. Use Import to map them.`
            : "Google calendar list is up to date.",
        variant: "info",
      });
    } catch {
      setFeedback({ text: "Could not refresh Google calendars.", variant: "error" });
    } finally {
      setRefreshing(false);
    }
  }

  async function onSyncModeChange(next: string) {
    if (!conn) return;
    setSavingMode(true);
    setFeedback(null);
    try {
      const res = await apiClient.patch<{ connection: CalendarConnectionSummary }>(
        `/api/calendar/connections/${conn.id}`,
        { syncMode: next },
      );
      setConnections((prev) =>
        prev.map((c) => (c.id === conn.id ? { ...c, ...res.connection } : c)),
      );
      setFeedback({
        text:
          next === "bidirectional"
            ? "Bidirectional sync enabled — grid edits will push to Google."
            : "Sync mode updated.",
        variant: "info",
      });
    } catch {
      setFeedback({ text: "Could not update sync mode.", variant: "error" });
    } finally {
      setSavingMode(false);
    }
  }

  async function removeDuplicates() {
    setFeedback(null);
    try {
      const res = await apiClient.post<{ removed: number }>("/api/calendar/dedupe");
      setFeedback({
        text:
          res.removed > 0
            ? `Removed ${res.removed} duplicate event${res.removed === 1 ? "" : "s"}.`
            : "No duplicate Google events found.",
        variant: "info",
      });
    } catch {
      setFeedback({ text: "Could not clean up duplicates.", variant: "error" });
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Calendar settings"
      description="Google sync, calendars (public, private, shared), and event categories"
    >
      <div className="space-y-4 px-6 pb-7 pt-2">
        <SettingsSection title="Google Calendar" defaultOpen>
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)]",
                connected
                  ? "bg-[var(--color-success-muted)]/40 text-[var(--color-success)]"
                  : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]",
              )}
              aria-hidden
            >
              <Calendar className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-medium">{connected ? "Connected" : "Not connected"}</p>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {connected && lastSync
                  ? `Last sync ${new Date(lastSync).toLocaleString()}`
                  : connected
                    ? "No sync completed yet"
                    : "Connect to discover calendars and import events"}
              </p>
            </div>
          </div>

          {connected && (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Sync mode</span>
              <Select
                value={syncMode}
                disabled={savingMode}
                onChange={(e) => void onSyncModeChange(e.target.value)}
              >
                <option value="import_only">{SYNC_MODE_SHORT.import_only}</option>
                <option value="manual">{SYNC_MODE_SHORT.manual}</option>
                <option value="bidirectional">{SYNC_MODE_SHORT.bidirectional}</option>
              </Select>
              <span className="block text-xs leading-relaxed text-[var(--color-text-muted)]">
                {SYNC_MODE_HELP[syncMode]} Household default: {defaultSyncMode}.
              </span>
            </label>
          )}

          {feedback && <Alert variant={feedback.variant}>{feedback.text}</Alert>}

          <CalendarSyncProgress status={syncStatus} compact />

          {isActive && (
            <p className="text-xs text-[var(--color-text-muted)]" role="status" aria-live="polite">
              Import in progress — you can close this panel; sync continues in the background.
            </p>
          )}

          {!oauthConfigured && (
            <Alert variant="info">
              Google OAuth is not configured on this server. Set client ID/secret in env.
            </Alert>
          )}

          {oauthConfigured && !connected && (
            <Alert variant={oauthFailureMessage ? "error" : "info"}>
              <p>Connect to discover your Google calendars, then import the ones you want.</p>
              {oauthFailureMessage && (
                <p className="mt-2 text-sm font-normal opacity-90">{oauthFailureMessage}</p>
              )}
            </Alert>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            {oauthConfigured && !connected && (
              <AnchorButton
                href={googleCalendarConnectUrl()}
                variant="primary"
                className="sm:flex-1"
              >
                Connect Google
              </AnchorButton>
            )}
            {connected && (
              <>
                <Button
                  className="sm:flex-1"
                  variant="primary"
                  loading={syncing}
                  onClick={() => void syncNow()}
                >
                  Sync now
                </Button>
                <Button className="sm:flex-1" variant="secondary" onClick={openImportWizard}>
                  Import calendars…
                </Button>
              </>
            )}
          </div>

          {oauthConfigured && (
            <details className="rounded-[var(--radius-md)] border border-[var(--color-border)]/80 bg-[var(--color-surface-elevated)]/40 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-muted)] marker:content-none hover:text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
                Advanced
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                {connected && (
                  <>
                    <Button
                      variant="secondary"
                      loading={refreshing}
                      onClick={() => void refreshSources()}
                    >
                      <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />
                      Refresh Google source list
                    </Button>
                    <Button variant="secondary" onClick={() => void removeDuplicates()}>
                      Remove duplicate events
                    </Button>
                  </>
                )}
                <AnchorButton href={googleCalendarConnectUrl()} variant="ghost">
                  {connected ? "Reconnect Google account" : "Connect Google"}
                </AnchorButton>
              </div>
            </details>
          )}
        </SettingsSection>

        <SettingsSection
          title="Calendars"
          description="Public calendars are visible to everyone in the household. Private calendars are only yours. Shared calendars are private but opened to specific members you choose."
        >
          <CalendarLanesPanel active={open} />
        </SettingsSection>

        <SettingsSection
          title="Event categories"
          description="Each calendar has its own categories. Events use category color — add buckets like “Mike — doctor” under Calendar settings."
        >
          <CalendarCategoriesPanel active={open} />
        </SettingsSection>
      </div>
    </Sheet>
  );
}
