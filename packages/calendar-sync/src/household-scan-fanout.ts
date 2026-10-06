/**
 * Per-household scan jobs (WHO-403, WHO-404).
 *
 * Every periodic scan used to sweep all households in one cross-tenant transaction, so one bad
 * household (or a user deleted mid-sweep) aborted the run for everyone, and a table without a
 * `worker_scan` policy looked empty without any error. Now the scheduler tick only works out which
 * households have something to do and enqueues one job per household; each job runs in that
 * household's own database context and a failure is that household's alone.
 */

export type HouseholdScanJob =
  | "health.med.reminder.household"
  | "health.check.reminder.household"
  | "health.supply.reminder.household"
  | "calendar.reminder.household"
  | "chore.reminder.household"
  | "chore.digest.household"
  | "expense.budget.household"
  | "school.reminder.household"
  | "drive.quota.household";

/** Adds a household's scan job to the queue. `jobId` makes a double enqueue a no-op. */
export type EnqueueHouseholdScan = (
  job: HouseholdScanJob,
  householdId: string,
  jobId: string,
) => Promise<void>;

/**
 * How often each scan's tick fires. Also the width of the window a household's job id is unique
 * within, so it must match the scheduler in queue.ts: a window wider than the tick would swallow
 * legitimate runs.
 */
export const HOUSEHOLD_SCAN_INTERVAL_MS: Record<HouseholdScanJob, number> = {
  "health.med.reminder.household": 5 * 60 * 1000,
  "health.check.reminder.household": 5 * 60 * 1000,
  "health.supply.reminder.household": 5 * 60 * 1000,
  "calendar.reminder.household": 5 * 60 * 1000,
  "chore.reminder.household": 5 * 60 * 1000,
  "school.reminder.household": 5 * 60 * 1000,
  "chore.digest.household": 15 * 60 * 1000,
  "expense.budget.household": 30 * 60 * 1000,
  "drive.quota.household": 30 * 60 * 1000,
};

/**
 * BullMQ ignores an `add` whose job id already exists, so a tick that fires twice in the same
 * window (a scheduler hiccup, a restart) cannot make a household run twice. Custom ids can't
 * contain ":", hence the dashes.
 */
export function householdScanJobId(job: HouseholdScanJob, householdId: string, now: Date): string {
  return `${job}-${householdId}-${Math.floor(now.getTime() / HOUSEHOLD_SCAN_INTERVAL_MS[job])}`;
}

/**
 * Enqueue `job` for each household id. One failed enqueue (a Redis blip) must not stop the rest,
 * but it must not vanish either: they are all attempted, then the failures are thrown together.
 */
export async function enqueueForHouseholds(
  job: HouseholdScanJob,
  householdIds: Iterable<string>,
  deps: { enqueue: EnqueueHouseholdScan; now?: Date },
): Promise<number> {
  const now = deps.now ?? new Date();
  const ids = [...new Set(householdIds)];
  const errors: unknown[] = [];
  let enqueued = 0;
  for (const householdId of ids) {
    try {
      await deps.enqueue(job, householdId, householdScanJobId(job, householdId, now));
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
