import { Queue } from "bullmq";
import type { SyncJobName, SyncJobPayload } from "./index.js";

/** BullMQ disallows ':' in queue names */
export const SYNC_QUEUE = "whome-calendar-sync";

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

/** Repeatable scan for due calendar reminder pushes (every 5 minutes). */
export async function ensureCalendarReminderScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.add(
    "calendar.reminder.scan",
    { name: "calendar.reminder.scan", payload: { householdId: "scan" } },
    {
      repeat: { every: 5 * 60 * 1000 },
      jobId: "calendar-reminder-scan",
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  );
}

/** Repeatable scan for due chore reminder pushes (every 5 minutes). */
export async function ensureChoreReminderScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.add(
    "chore.reminder.scan",
    { name: "chore.reminder.scan", payload: { householdId: "scan" } },
    {
      repeat: { every: 5 * 60 * 1000 },
      jobId: "chore-reminder-scan",
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  );
}

/** Repeatable scan for expense budget threshold pushes (every 30 minutes). */
export async function ensureExpenseBudgetScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.add(
    "expense.budget.scan",
    { name: "expense.budget.scan", payload: { householdId: "scan" } },
    {
      repeat: { every: 30 * 60 * 1000 },
      jobId: "expense-budget-scan",
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  );
}

/** Repeatable scan for school assignment due/overdue pushes (every 5 minutes). */
export async function ensureSchoolReminderScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.add(
    "school.reminder.scan",
    { name: "school.reminder.scan", payload: { householdId: "scan" } },
    {
      repeat: { every: 5 * 60 * 1000 },
      jobId: "school-reminder-scan",
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  );
}

/** Morning chore digest (every 15 minutes; fires once per user after 08:00 local). */
export async function ensureChoreDigestScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.add(
    "chore.digest.scan",
    { name: "chore.digest.scan", payload: { householdId: "scan" } },
    {
      repeat: { every: 15 * 60 * 1000 },
      jobId: "chore-digest-scan",
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  );
}

/** Drive quota threshold warning (every 30 minutes). */
export async function ensureDriveQuotaScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.add(
    "drive.quota.scan",
    { name: "drive.quota.scan", payload: { householdId: "scan" } },
    {
      repeat: { every: 30 * 60 * 1000 },
      jobId: "drive-quota-scan",
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  );
}

/** Health medication dose reminders (every 5 minutes). */
export async function ensureHealthMedReminderScheduler(redisUrl: string): Promise<void> {
  const q = getSyncQueue(redisUrl);
  await q.add(
    "health.med.reminder.scan",
    { name: "health.med.reminder.scan", payload: { householdId: "scan" } },
    {
      repeat: { every: 5 * 60 * 1000 },
      jobId: "health-med-reminder-scan",
      removeOnComplete: 20,
      removeOnFail: 20,
    },
  );
}
