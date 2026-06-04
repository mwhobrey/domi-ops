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
