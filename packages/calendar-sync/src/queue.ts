import { Queue } from "bullmq";
import type { EnqueueHouseholdScan } from "./household-scan-fanout.js";
import type { SyncJobName, SyncJobPayload } from "./index.js";

/** BullMQ disallows ':' in queue names */
export const SYNC_QUEUE = "domi-ops-calendar-sync";

let queue: Queue<{ name: SyncJobName; payload: SyncJobPayload }> | null = null;

export function getSyncQueue(redisUrl: string): Queue<{ name: SyncJobName; payload: SyncJobPayload }> {
  if (!queue) {
    queue = new Queue(SYNC_QUEUE, { connection: { url: redisUrl } });
  }
  return queue;
}

export async function enqueueSyncJob(
  redisUrl: string,
  name: SyncJobName,
  payload: SyncJobPayload,
): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.add(name, { name, payload }, { removeOnComplete: 100, removeOnFail: 50 });
}

/**
 * Enqueue one household's scan job (see household-scan-fanout.ts). `jobId` is unique per
 * household per scan window, so a tick that fires twice cannot run a household twice. No retries:
 * a reminder is time-sensitive and the next tick covers a miss.
 */
export function householdScanEnqueuer(redisUrl: string): EnqueueHouseholdScan {
  return async (job, householdId, jobId) => {
    const q = getSyncQueue(redisUrl);
    await q.add(
      job,
      { name: job, payload: { householdId } },
      { jobId, attempts: 1, removeOnComplete: 20, removeOnFail: 50 },
    );
  };
}

/**
 * bullmq v6 removed the `repeat`/`jobId` combo from `Queue.add()`'s `JobsOptions` — repeatable
 * jobs are now registered via `upsertJobScheduler(schedulerId, repeatOpts, jobTemplate)`
 * ("Job Schedulers"), which is idempotent (create-or-update) exactly like the old `jobId`-pinned
 * `.add()` call was, so each `ensureXScheduler` below is still safe to call on every worker boot.
 */

/** Repeatable scan for due calendar reminder pushes (every 5 minutes). */
export async function ensureCalendarReminderScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.upsertJobScheduler(
    "calendar-reminder-scan",
    { every: 5 * 60 * 1000 },
    {
      name: "calendar.reminder.scan",
      data: { name: "calendar.reminder.scan", payload: { householdId: "scan" } },
      opts: { removeOnComplete: 20, removeOnFail: 20 },
    },
  );
}

/** Repeatable scan for due chore reminder pushes (every 5 minutes). */
export async function ensureChoreReminderScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.upsertJobScheduler(
    "chore-reminder-scan",
    { every: 5 * 60 * 1000 },
    {
      name: "chore.reminder.scan",
      data: { name: "chore.reminder.scan", payload: { householdId: "scan" } },
      opts: { removeOnComplete: 20, removeOnFail: 20 },
    },
  );
}

/** Repeatable scan for expense budget threshold pushes (every 30 minutes). */
export async function ensureExpenseBudgetScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.upsertJobScheduler(
    "expense-budget-scan",
    { every: 30 * 60 * 1000 },
    {
      name: "expense.budget.scan",
      data: { name: "expense.budget.scan", payload: { householdId: "scan" } },
      opts: { removeOnComplete: 20, removeOnFail: 20 },
    },
  );
}

/** Repeatable scan for school assignment due/overdue pushes (every 5 minutes). */
export async function ensureSchoolReminderScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.upsertJobScheduler(
    "school-reminder-scan",
    { every: 5 * 60 * 1000 },
    {
      name: "school.reminder.scan",
      data: { name: "school.reminder.scan", payload: { householdId: "scan" } },
      opts: { removeOnComplete: 20, removeOnFail: 20 },
    },
  );
}

/** Morning chore digest (every 15 minutes; fires once per user after 08:00 local). */
export async function ensureChoreDigestScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.upsertJobScheduler(
    "chore-digest-scan",
    { every: 15 * 60 * 1000 },
    {
      name: "chore.digest.scan",
      data: { name: "chore.digest.scan", payload: { householdId: "scan" } },
      opts: { removeOnComplete: 20, removeOnFail: 20 },
    },
  );
}

/** Drive quota threshold warning (every 30 minutes). */
export async function ensureDriveQuotaScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.upsertJobScheduler(
    "drive-quota-scan",
    { every: 30 * 60 * 1000 },
    {
      name: "drive.quota.scan",
      data: { name: "drive.quota.scan", payload: { householdId: "scan" } },
      opts: { removeOnComplete: 20, removeOnFail: 20 },
    },
  );
}

/** Health medication dose reminders (every 5 minutes). */
export async function ensureHealthMedReminderScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.upsertJobScheduler(
    "health-med-reminder-scan",
    { every: 5 * 60 * 1000 },
    {
      name: "health.med.reminder.scan",
      data: { name: "health.med.reminder.scan", payload: { householdId: "scan" } },
      opts: { removeOnComplete: 20, removeOnFail: 20 },
    },
  );
}

/** Health check reminders (every 5 minutes), same cadence as medication doses. */
export async function ensureHealthCheckReminderScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.upsertJobScheduler(
    "health-check-reminder-scan",
    { every: 5 * 60 * 1000 },
    {
      name: "health.check.reminder.scan",
      data: { name: "health.check.reminder.scan", payload: { householdId: "scan" } },
      opts: { removeOnComplete: 20, removeOnFail: 20 },
    },
  );
}

/** Pill organizer fill and medication refill reminders (every 5 minutes, WHO-432). */
export async function ensureHealthSupplyReminderScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.upsertJobScheduler(
    "health-supply-reminder-scan",
    { every: 5 * 60 * 1000 },
    {
      name: "health.supply.reminder.scan",
      data: { name: "health.supply.reminder.scan", payload: { householdId: "scan" } },
      opts: { removeOnComplete: 20, removeOnFail: 20 },
    },
  );
}

/** MyAllyFile med sync push (WHO-363): every 30s; per-link debounce lives in the scan. */
export async function ensureMyallyfileSyncScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.upsertJobScheduler(
    "myallyfile-sync-scan",
    { every: 30 * 1000 },
    {
      name: "myallyfile.sync.scan",
      data: { name: "myallyfile.sync.scan", payload: { householdId: "scan" } },
      opts: { removeOnComplete: 20, removeOnFail: 20 },
    },
  );
}
