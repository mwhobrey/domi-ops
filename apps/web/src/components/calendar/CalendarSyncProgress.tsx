"use client";

import type { CalendarSyncStatus } from "../../lib/use-calendar-sync-status";
import { Alert } from "../ui";

export function CalendarSyncProgress({
  status,
  compact = false,
}: {
  status: CalendarSyncStatus | null;
  compact?: boolean;
}) {
  if (!status?.connected || !status.run) return null;

  const { run, linked = [] } = status;
  const progress = run.progress;
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;

  if (!run.active && run.status !== "failed" && !compact) {
    const errors = linked.filter((l) => l.lastSyncError);
    if (!errors.length) return null;
  }

  if (run.status === "idle" && !run.error) {
    const errors = linked.filter((l) => l.syncEnabled && l.lastSyncError);
    if (!errors.length) return null;
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {run.active && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">
              {run.status === "queued" ? "Sync queued…" : "Syncing Google calendars…"}
            </span>
            {progress && progress.total > 0 && (
              <span className="text-[var(--color-text-muted)] tabular-nums">
                {progress.done}/{progress.total}
              </span>
            )}
          </div>
          {pct !== null && (
            <div
              className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-muted)]"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          {progress?.current && (
            <p className="text-xs text-[var(--color-text-muted)] truncate">
              {progress.current}
            </p>
          )}
        </div>
      )}

      {run.status === "failed" && run.error && (
        <Alert variant="error" className="text-sm">
          Sync failed: {run.error}
        </Alert>
      )}

      {!run.active &&
        linked
          .filter((l) => l.syncEnabled && l.lastSyncError)
          .map((l) => (
            <Alert key={l.id} variant="error" className="text-sm">
              {l.summary ?? "Calendar"}: {l.lastSyncError}
            </Alert>
          ))}
    </div>
  );
}
