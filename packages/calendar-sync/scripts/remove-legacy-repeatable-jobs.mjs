#!/usr/bin/env node
// One-time cleanup for the bullmq v5 -> v6 migration (WHO deps PR bumping bullmq to 6.3.6).
//
// v6 replaced the old `Queue.add(name, data, { repeat, jobId })` repeatable-job mechanism with
// Job Schedulers (`Queue.upsertJobScheduler(schedulerId, repeatOpts, jobTemplate)` —
// packages/calendar-sync/src/queue.ts). The old repeatable-job records already sitting in Redis
// from every worker boot before this deploy are NOT migrated or removed automatically — v6 still
// recognizes and keeps firing them (surfaced by `getJobSchedulers()` under their old
// auto-generated hash key, alongside the new human-readable-keyed schedulers) which means, left
// alone, every reminder scan doubles up: once on its old schedule, once on its new one.
//
// Run this once per environment (local dev, dogfood, hosted) after deploying the bullmq v6
// worker, before its next boot creates the new schedulers — or any time after, since it only
// removes entries whose key isn't one of the seven current scheduler ids below.
//
// Usage: REDIS_URL=<connection string> node remove-legacy-repeatable-jobs.mjs

import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("REDIS_URL is required");
  process.exit(1);
}

// Keep in sync with the jobSchedulerId values in packages/calendar-sync/src/queue.ts.
const KNOWN_SCHEDULER_KEYS = new Set([
  "calendar-reminder-scan",
  "chore-reminder-scan",
  "expense-budget-scan",
  "school-reminder-scan",
  "chore-digest-scan",
  "drive-quota-scan",
  "health-med-reminder-scan",
]);

const SYNC_QUEUE = "domi-ops-calendar-sync";
const queue = new Queue(SYNC_QUEUE, { connection: { url: redisUrl } });

try {
  const schedulers = await queue.getJobSchedulers();
  const legacy = schedulers.filter((s) => !KNOWN_SCHEDULER_KEYS.has(s.key));

  if (legacy.length === 0) {
    console.log("OK: no legacy repeatable-job entries found — nothing to clean up.");
  } else {
    console.log(`Removing ${legacy.length} legacy repeatable-job entr${legacy.length === 1 ? "y" : "ies"}:`);
    for (const s of legacy) {
      console.log(`  - ${s.key} (${s.name})`);
      await queue.removeJobScheduler(s.key);
    }
    console.log("Done.");
  }
} finally {
  await queue.close();
}
