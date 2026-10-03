import type { Database } from "@domi-ops/db";
import { healthChecks, healthMedicationGroups, healthMedications, households } from "@domi-ops/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { householdHasHealthModule } from "./health-reminder-shared.js";

/**
 * Health reminders run as one job per household (WHO-403).
 *
 * The scheduler's 5-minute tick used to do the whole sweep itself, in a single cross-tenant
 * transaction. That meant one bad household, or a user deleted mid-sweep, aborted the run for
 * everyone, and it needed cross-tenant read access to health data (which is how a missing policy on
 * the caregiver table hid every caregiver on hosted without a single error).
 *
 * Now the tick only decides *which* households have something to remind about and enqueues a job
 * for each. Each job runs in that household's own database context, so it can only ever see that
 * household's rows, and a failure is that household's alone (and reported as such).
 */

export type HouseholdReminderJob = "health.med.reminder.household" | "health.check.reminder.household";

/** Adds a household's reminder job to the queue. `jobId` makes a double enqueue a no-op. */
export type EnqueueHouseholdReminderScan = (
  job: HouseholdReminderJob,
  householdId: string,
  jobId: string,
) => Promise<void>;

/** How often the tick fires; also the width of the window one household job is unique within. */
export const REMINDER_SCAN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * BullMQ ignores an `add` whose job id already exists, so a tick that fires twice in the same
 * window (a scheduler hiccup, a restart) cannot make a household run twice. Custom ids can't
 * contain ":", hence the dashes.
 */
export function householdReminderJobId(job: HouseholdReminderJob, householdId: string, now: Date): string {
  return `${job}-${householdId}-${Math.floor(now.getTime() / REMINDER_SCAN_INTERVAL_MS)}`;
}

/** Enqueue a job for every household in `candidateIds` that has the health module on. */
async function fanOut(
  db: Database,
  job: HouseholdReminderJob,
  candidateIds: string[],
  deps: { enqueue: EnqueueHouseholdReminderScan; now?: Date },
): Promise<number> {
  if (candidateIds.length === 0) return 0;
  const now = deps.now ?? new Date();

  const rows = await db
    .select({ id: households.id, modulesEnabled: households.modulesEnabled })
    .from(households)
    .where(inArray(households.id, candidateIds));
  const ids = rows.filter((h) => householdHasHealthModule(h.modulesEnabled)).map((h) => h.id);

  // One failed enqueue (a Redis blip) must not stop the rest, but it must not vanish either.
  const errors: unknown[] = [];
  let enqueued = 0;
  for (const householdId of ids) {
    try {
      await deps.enqueue(job, householdId, householdReminderJobId(job, householdId, now));
      enqueued += 1;
    } catch (e) {
      errors.push(e);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, `Could not enqueue ${errors.length} of ${ids.length} ${job} jobs`);
  }
  return enqueued;
}

/** Households with at least one medication or medication group that can still send a reminder. */
export async function fanOutMedReminderScans(
  db: Database,
  deps: { enqueue: EnqueueHouseholdReminderScan; now?: Date },
): Promise<number> {
  const meds = await db
    .selectDistinct({ id: healthMedications.householdId })
    .from(healthMedications)
    .where(eq(healthMedications.enabled, true));
  const groups = await db
    .selectDistinct({ id: healthMedicationGroups.householdId })
    .from(healthMedicationGroups)
    .where(eq(healthMedicationGroups.enabled, true));
  const ids = [...new Set([...meds, ...groups].map((r) => r.id))];
  return fanOut(db, "health.med.reminder.household", ids, deps);
}

/** Households with at least one health check that is on (not paused, not deleted). */
export async function fanOutCheckReminderScans(
  db: Database,
  deps: { enqueue: EnqueueHouseholdReminderScan; now?: Date },
): Promise<number> {
  const checks = await db
    .selectDistinct({ id: healthChecks.householdId })
    .from(healthChecks)
    .where(and(eq(healthChecks.enabled, true), isNull(healthChecks.deletedAt)));
  return fanOut(
    db,
    "health.check.reminder.household",
    checks.map((r) => r.id),
    deps,
  );
}
