import { Worker } from "bullmq";
import * as Sentry from "@sentry/node";
import { loadEnv } from "@domi-ops/config";
import { createDb, withHouseholdContext, withWorkerScanContext } from "@domi-ops/db";
import { initSentry } from "./lib/sentry.js";
import {
  SYNC_QUEUE,
  type SyncJobName,
  type SyncJobPayload,
  runCalendarSyncJob,
  ensureCalendarReminderScheduler,
  ensureChoreReminderScheduler,
  ensureExpenseBudgetScheduler,
  ensureSchoolReminderScheduler,
  ensureChoreDigestScheduler,
  ensureDriveQuotaScheduler,
  ensureHealthMedReminderScheduler,
} from "@domi-ops/calendar-sync";

const env = loadEnv();
initSentry(env);
const db = createDb(env.DATABASE_URL);
const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";

const CROSS_TENANT_SCAN_JOBS = new Set<SyncJobName>([
  "calendar.reminder.scan",
  "chore.reminder.scan",
  "expense.budget.scan",
  "school.reminder.scan",
  "chore.digest.scan",
  "drive.quota.scan",
  "health.med.reminder.scan",
]);

const worker = new Worker<{ name: SyncJobName; payload: SyncJobPayload }>(
  SYNC_QUEUE,
  async (job) => {
    const { name, payload } = job.data;

    if (CROSS_TENANT_SCAN_JOBS.has(name)) {
      return withWorkerScanContext(db, (scanDb) =>
        runCalendarSyncJob(scanDb, env, name, payload),
      );
    }

    const householdId = payload.householdId;
    if (!householdId || householdId === "scan") {
      throw new Error(`householdId required for job ${name}`);
    }

    return withHouseholdContext(db, householdId, (tx) =>
      runCalendarSyncJob(tx, env, name, payload),
    );
  },
  { connection: { url: redisUrl } },
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed (${job.data.name})`);
});

worker.on("failed", (job, err) => {
  // console.log, not console.error — captureConsoleIntegration (initSentry) auto-reports every
  // console.error call site, so pairing it with the explicit captureException below double-fired
  // one Sentry issue per failure. captureException keeps the structured jobName tag (more useful
  // for triage than console.error's free text would be); this line stays for local log
  // visibility only.
  console.log(`Job ${job?.id} failed:`, err);
  Sentry.captureException(err, { tags: { jobName: job?.data.name } });
});

void ensureCalendarReminderScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule calendar reminder scan", err);
});

void ensureChoreReminderScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule chore reminder scan", err);
});

void ensureExpenseBudgetScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule expense budget scan", err);
});

void ensureSchoolReminderScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule school reminder scan", err);
});

void ensureChoreDigestScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule chore digest scan", err);
});

void ensureDriveQuotaScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule drive quota scan", err);
});

void ensureHealthMedReminderScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule health med reminder scan", err);
});

console.log(`domi-ops worker listening on queue ${SYNC_QUEUE}`);
