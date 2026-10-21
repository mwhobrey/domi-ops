import { Worker } from "bullmq";
import * as Sentry from "@sentry/node";
import { loadEnv } from "@domi-ops/config";
import { createDb, withWorkerScanContext } from "@domi-ops/db";
import { runHouseholdSyncJob } from "./lib/household-sync-job.js";
import { initSentry } from "./lib/sentry.js";
import {
  SYNC_QUEUE,
  type SyncJobName,
  type SyncJobPayload,
  runCalendarSyncJob,
  ensureCalendarReminderScheduler,
  ensureCalendarPushScheduler,
  ensureChoreReminderScheduler,
  ensureExpenseBudgetScheduler,
  ensureSchoolReminderScheduler,
  ensureChoreDigestScheduler,
  ensureDriveQuotaScheduler,
  ensureHealthMedReminderScheduler,
  ensureHealthCheckReminderScheduler,
  ensureHealthSupplyReminderScheduler,
  ensureMyallyfileSyncScheduler,
  ensureWithingsSyncScheduler,
} from "@domi-ops/calendar-sync";

const env = loadEnv();
initSentry(env);
const db = createDb(env.DATABASE_URL);
const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";

const CROSS_TENANT_SCAN_JOBS = new Set<SyncJobName>([
  "calendar.reminder.scan",
  "google.calendar.push.scan",
  "chore.reminder.scan",
  "expense.budget.scan",
  "school.reminder.scan",
  "chore.digest.scan",
  "drive.quota.scan",
  "health.med.reminder.scan",
  "health.check.reminder.scan",
  "health.supply.reminder.scan",
  "myallyfile.sync.scan",
  "withings.sync.scan",
]);

/**
 * Jobs that open their own short household-scoped transactions instead of running inside one. They
 * call a third party between database writes and hold a secret that party rotates on use (Withings
 * retires the old refresh token when it issues a new one), so one long transaction that can roll back,
 * or be cut off by a deploy, would lose it.
 */
const OWN_CONTEXT_JOBS = new Set<SyncJobName>(["withings.sync.household"]);

const worker = new Worker<{ name: SyncJobName; payload: SyncJobPayload }>(
  SYNC_QUEUE,
  async (job) => {
    const { name, payload } = job.data;

    if (OWN_CONTEXT_JOBS.has(name)) {
      if (!payload.householdId || payload.householdId === "scan") {
        throw new Error(`householdId required for job ${name}`);
      }
      return runCalendarSyncJob(db, env, name, payload);
    }

    if (CROSS_TENANT_SCAN_JOBS.has(name)) {
      return withWorkerScanContext(db, (scanDb) =>
        runCalendarSyncJob(scanDb, env, name, payload),
      );
    }

    return runHouseholdSyncJob(db, env, name, payload);
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
  // Per-household jobs (health reminders) carry their household so a failure is attributable.
  Sentry.captureException(err, {
    tags: { jobName: job?.data.name },
    extra: { householdId: job?.data.payload.householdId },
  });
});

void ensureCalendarPushScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule calendar push retries", err);
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
void ensureHealthCheckReminderScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule health check reminder scan", err);
});

void ensureHealthSupplyReminderScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule health supply reminder scan", err);
});

void ensureMyallyfileSyncScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule MyAllyFile sync scan", err);
});

void ensureWithingsSyncScheduler(redisUrl).catch((err) => {
  console.error("Failed to schedule Withings sync scan", err);
});

console.log(`domi-ops worker listening on queue ${SYNC_QUEUE}`);
