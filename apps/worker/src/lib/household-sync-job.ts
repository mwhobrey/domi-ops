import type { Env } from "@domi-ops/config";
import { withHouseholdContext, type Database } from "@domi-ops/db";
import { runCalendarSyncJob, setSyncRun, type SyncJobName, type SyncJobPayload } from "@domi-ops/calendar-sync";

export async function runHouseholdSyncJob(db: Database, env: Env, name: SyncJobName, payload: SyncJobPayload): Promise<void> {
  const householdId = payload.householdId;
  if (!householdId || householdId === "scan") throw new Error(`householdId required for job ${name}`);
  try {
    await withHouseholdContext(db, householdId, tx => runCalendarSyncJob(tx, env, name, payload));
  } catch (error) {
    // The failed job's transaction rolls back its status writes too.
    if (name.startsWith("google.calendar.") && payload.connectionId) {
      await withHouseholdContext(db, householdId, tx => setSyncRun(tx, payload.connectionId!, {
        status: "failed", error: "Calendar sync could not finish. Try syncing again or check Google access.",
      }));
    }
    throw error;
  }
}
