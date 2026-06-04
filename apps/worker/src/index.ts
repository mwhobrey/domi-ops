import { Worker } from "bullmq";
import { loadEnv } from "@whome/config";
import { createDb } from "@whome/db";
import {
  SYNC_QUEUE,
  type SyncJobName,
  type SyncJobPayload,
  runCalendarSyncJob,
  ensureCalendarReminderScheduler,
} from "@whome/calendar-sync";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";

const worker = new Worker<{ name: SyncJobName; payload: SyncJobPayload }>(
  SYNC_QUEUE,
  async (job) => {
    await runCalendarSyncJob(db, env, job.data.name, job.data.payload);
  },
  { connection: { url: redisUrl } },
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed (${job.data.name})`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed`, err);
});

void ensureCalendarReminderScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule calendar reminder scan", err);
});

console.log(`whome worker listening on queue ${SYNC_QUEUE}`);
