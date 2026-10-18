import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb, closeDb, withHouseholdContext, withSystemContext, householdMembers, households, users, calendars, calendarEvents, recurringRules, healthEvents, driveObjects } from "@domi-ops/db";
import { SYNC_QUEUE } from "@domi-ops/calendar-sync";
import { decryptSensitive } from "@domi-ops/crypto";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createS3Client } from "../../apps/api/dist/lib/s3.js";

if (process.env.QA_TOKEN?.length !== 64 || !process.env.DATABASE_URL?.includes("@postgres:5432/domi_ops")) throw new Error("Harness database required");
const fixture = JSON.parse(await readFile("/qa/fixtures.json", "utf8")), alpha = fixture.households.find((h) => h.label === "alpha");
const db = createDb(process.env.DATABASE_URL), targetUrl = process.env.DATABASE_URL.replace("@postgres:", "@archive:");
const target = createDb(targetUrl), queue = new Queue(SYNC_QUEUE, { connection: { url: process.env.REDIS_URL } });
const evidence = {};
const storageEnv = { ...process.env, S3_FORCE_PATH_STYLE: true }, client = createS3Client(storageEnv);
const directory = await mkdtemp("/tmp/domi-qa-archive-");
let memberUserIds = [];
let workerCalendarId;
try {
  const [role] = await db.execute(sql`select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname=current_user`);
  assert.equal(role.name, "domi_ops_app"); assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
  assert.equal((await db.select().from(households)).length, 0);
  const isolated = await withHouseholdContext(db, alpha.householdId, (tx) => tx.select().from(households)); assert.deepEqual(isolated.map((h) => h.id), [alpha.householdId]);
  evidence.role = { name: role.name, bypassRls: false, unscopedHouseholds: 0 };
  const created = await withHouseholdContext(db, alpha.householdId, async (tx) => {
    const [calendar] = await tx.insert(calendars).values({ householdId: alpha.householdId, ownerUserId: alpha.userId, name: "Worker QA", visibility: "household" }).returning();
    const [rule] = await tx.insert(recurringRules).values({ householdId: alpha.householdId, calendarId: calendar.id, title: `QA worker ${randomUUID()}`, rrule: "FREQ=DAILY;COUNT=1", startDate: new Date().toISOString().slice(0, 10), allDay: true }).returning(); return { calendarId: calendar.id, rule };
  });
  workerCalendarId = created.calendarId;
  const rule = created.rule;
  const job = await queue.add("local-qa-materialize", { name: "recurring.materialize", payload: { householdId: alpha.householdId } });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !["completed", "failed"].includes(await job.getState())) await new Promise((r) => setTimeout(r, 200));
  assert.equal(await job.getState(), "completed", job.failedReason);
  const generated = await withHouseholdContext(db, alpha.householdId, (tx) => tx.select().from(calendarEvents).where(eq(calendarEvents.recurringRuleId, rule.id)));
  assert.equal(generated.length, 1); evidence.worker = { queue: SYNC_QUEUE, job: "recurring.materialize", generatedEvents: 1 };
  memberUserIds = await withHouseholdContext(db, alpha.householdId, async (tx) => (await tx.select({ userId: householdMembers.userId }).from(householdMembers)).map((m) => m.userId));
  const archive = join(directory, "archive"), transferKey = randomBytes(32).toString("hex"), targetKey = randomBytes(32).toString("hex");
  const baseEnv = { ...process.env, ARCHIVE_S3_ENDPOINT: process.env.S3_ENDPOINT, ARCHIVE_S3_ACCESS_KEY: process.env.S3_ACCESS_KEY, ARCHIVE_S3_SECRET_KEY: process.env.S3_SECRET_KEY, ARCHIVE_KEY: transferKey, ARCHIVE_S3_FORCE_PATH_STYLE: "true", ARCHIVE_HOUSEHOLD_ID: alpha.householdId };
  const run = (args, env) => JSON.parse(execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/household-archive.mts", ...args], { env: { ...baseEnv, ...env }, encoding: "utf8" }).trim());
  const sourceEnv = { ARCHIVE_DATABASE_URL: process.env.DATABASE_URL, ARCHIVE_INSTANCE_ENCRYPTION_KEY: process.env.ENCRYPTION_KEY, ARCHIVE_S3_BUCKET: "hosted-qa" };
  const restoreEnv = { ARCHIVE_DATABASE_URL: targetUrl, ARCHIVE_INSTANCE_ENCRYPTION_KEY: targetKey, ARCHIVE_S3_BUCKET: "hosted-qa-restore" };
  const exported = run(["export", archive, "--approved-private-data-export"], sourceEnv), dryRun = run(["restore", archive], restoreEnv), restored = run(["restore", archive, "--apply"], restoreEnv);
  assert.equal(dryRun.applied, false); assert.equal(restored.applied, true); assert(exported.files > 0);
  await withHouseholdContext(target, alpha.householdId, async (tx) => {
    const [health] = await tx.select().from(healthEvents).where(eq(healthEvents.id, alpha.healthId)); assert.equal(decryptSensitive(health.title, targetKey), "alpha synthetic private health record");
    const [file] = await tx.select().from(driveObjects).where(eq(driveObjects.id, alpha.fileId)); assert.equal(file.visibility, "private");
    const body = await client.send(new GetObjectCommand({ Bucket: "hosted-qa-restore", Key: file.s3Key })); assert.match(await body.Body.transformToString(), /alpha private synthetic file/);
  });
  evidence.archive = { exportedFiles: exported.files, dryRun: true, restored: true, targetKeyDecryption: true, privateFileRestored: true };
  console.log(JSON.stringify(evidence));
} finally {
  if (workerCalendarId) await withHouseholdContext(db, alpha.householdId, async (tx) => {
    await tx.delete(calendarEvents).where(eq(calendarEvents.calendarId, workerCalendarId));
    await tx.delete(recurringRules).where(eq(recurringRules.calendarId, workerCalendarId));
    await tx.delete(calendars).where(eq(calendars.id, workerCalendarId));
  });
  // The destination is exclusively this lab's restore DB; remove only the exported IDs.
  await withSystemContext(target, async (tx) => { await tx.delete(households).where(eq(households.id, alpha.householdId)); if (memberUserIds.length) await tx.delete(users).where(inArray(users.id, memberUserIds)); });
  for (const prefix of [`drive/${alpha.householdId}/`, `school/${alpha.householdId}/`, `avatars/${alpha.householdId}/`, `households/${alpha.householdId}/`]) {
    let cursor;
    do { const page = await client.send(new ListObjectsV2Command({ Bucket: "hosted-qa-restore", Prefix: prefix, ContinuationToken: cursor })); for (const object of page.Contents ?? []) await client.send(new DeleteObjectCommand({ Bucket: "hosted-qa-restore", Key: object.Key })); cursor = page.IsTruncated ? page.NextContinuationToken : undefined; } while (cursor);
  }
  await queue.close(); client.destroy(); await closeDb(db); await closeDb(target); await rm(directory, { recursive: true });
}
