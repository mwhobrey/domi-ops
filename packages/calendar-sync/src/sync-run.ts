import type { Database } from "@whome/db";
import { calendarConnections } from "@whome/db";
import { eq } from "drizzle-orm";

export type SyncRunStatus = "idle" | "queued" | "syncing" | "failed";

export type SyncRunProgress = {
  done: number;
  total: number;
  current?: string;
};

export function parseSyncRunProgress(raw: string | null): SyncRunProgress | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SyncRunProgress;
    if (typeof parsed.done === "number" && typeof parsed.total === "number") {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function setSyncRun(
  db: Database,
  connectionId: string,
  opts: {
    status: SyncRunStatus;
    progress?: SyncRunProgress | null;
    error?: string | null;
    touchLastSync?: boolean;
  },
): Promise<void> {
  await db
    .update(calendarConnections)
    .set({
      syncRunStatus: opts.status,
      syncRunProgress: opts.progress ? JSON.stringify(opts.progress) : null,
      syncRunError: opts.error ? opts.error.slice(0, 500) : null,
      ...(opts.touchLastSync ? { lastSyncAt: new Date() } : {}),
    })
    .where(eq(calendarConnections.id, connectionId));
}
