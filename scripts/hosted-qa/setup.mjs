import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, closeDb, withSystemContext, households, householdMembers, householdSubscriptions, users, baAccounts, notes, schoolClasses, schoolAssignments, schoolEnrollments, healthEvents, driveObjects, browserUploads } from "@domi-ops/db";
import { hashPassword, provisionUsernameMember } from "@domi-ops/auth";
import { encryptSensitive } from "@domi-ops/crypto";
import { HOSTED_HOUSEHOLD_MODULES } from "@domi-ops/config";
import { ensureS3Bucket, putObject } from "../../apps/api/dist/lib/s3.js";

if (process.env.QA_TOKEN?.length !== 64 || !process.env.QA_ADMIN_PASSWORD) throw new Error("Isolated harness configuration required");
for (const host of ["postgres", "archive"]) {
  const env = { ...process.env, DATABASE_URL: `postgresql://domi_ops:${process.env.QA_ADMIN_PASSWORD}@${host}:5432/domi_ops` };
  execFileSync(process.execPath, ["packages/db/dist/migrate.js"], { env, stdio: "inherit" });
  execFileSync(process.execPath, ["packages/db/scripts/create-hosted-app-role.mjs"], { env, stdio: "inherit" });
}
const previous = await readFile("/qa/fixtures.json", "utf8").then(JSON.parse).catch(() => null);
if (previous) { console.log("Existing QA fixtures retained. Use qa:hosted:reset for a fresh lab."); process.exit(0); }
const db = createDb(`postgresql://domi_ops:${process.env.QA_ADMIN_PASSWORD}@postgres:5432/domi_ops`);
const password = "HostedQa2026!", passwordHash = await hashPassword(password);
const fixture = { password, appUrl: process.env.PUBLIC_APP_URL, marketingUrl: process.env.PUBLIC_MARKETING_URL, households: [] };
const env = { ...process.env, S3_FORCE_PATH_STYLE: true, DRIVE_UPLOAD_MAX_BYTES: 10485760 };
try {
  for (const bucket of ["hosted-qa", "hosted-qa-restore"]) await ensureS3Bucket({ ...env, S3_BUCKET: bucket });
  await withSystemContext(db, async (tx) => {
    if ((await tx.select().from(households)).length) throw new Error("Unrecognized data in QA database; refusing to seed over it");
    for (const label of ["alpha", "beta", "expired"]) {
      const [household] = await tx.insert(households).values({ name: `${label.toUpperCase()} synthetic QA household`, slug: `qa-${label}`, timezone: "America/Chicago", tier: "hosted_starter", modulesEnabled: JSON.stringify(HOSTED_HOUSEHOLD_MODULES), storageQuotaBytes: 10485760 }).returning();
      const email = `${label}@hosted-qa.example.test`;
      const [user] = await tx.insert(users).values({ email, displayName: `${label} QA owner`, emailVerified: true }).returning();
      await tx.insert(baAccounts).values({ userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash });
      const [member] = await tx.insert(householdMembers).values({ householdId: household.id, userId: user.id, role: "owner", name: `${label} QA owner`, onboardingDismissedAt: new Date() }).returning();
      const status = label === "expired" ? "canceled" : "active", customerId = `cus_qa_${label}`, subscriptionId = `sub_qa_${label}`;
      await tx.insert(householdSubscriptions).values({ householdId: household.id, modulesEntitled: JSON.stringify(HOSTED_HOUSEHOLD_MODULES), provider: "stripe", stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, status, currentPeriodEnd: new Date(Date.now() + 30 * 86400000) });
      const [note] = await tx.insert(notes).values({ householdId: household.id, title: `${label} confidential fixture note`, content: "Fictional QA data only.", visibility: "private", createdByUserId: user.id }).returning();
      const [health] = await tx.insert(healthEvents).values({ householdId: household.id, memberId: member.id, type: "other", title: encryptSensitive(`${label} synthetic private health record`, process.env.ENCRYPTION_KEY), startedAt: new Date(), visibility: "private", createdByUserId: user.id }).returning();
      const bytes = Buffer.from(`${label} private synthetic file\n`), fileId = randomUUID(), key = `drive/${household.id}/${fileId}/private.txt`;
      await putObject(env, key, bytes, "text/plain");
      await tx.insert(driveObjects).values({ id: fileId, householdId: household.id, kind: "file", title: `${label} private fixture file`, visibility: "private", createdByUserId: user.id, s3Key: key, contentType: "text/plain", byteSize: bytes.length });
      await tx.insert(browserUploads).values({ id: randomUUID(), householdId: household.id, memberId: member.id, purpose: "drive", s3Key: key, contentType: "text/plain", maxBytes: bytes.length, byteSize: bytes.length, state: "consumed", claimedBy: fileId, expiresAt: new Date() });
      await tx.update(households).set({ storageUsedBytes: bytes.length }).where(eq(households.id, household.id));
      const item = { label, householdId: household.id, userId: user.id, memberId: member.id, email, status, customerId, subscriptionId, noteId: note.id, healthId: health.id, fileId, key };
      fixture.households.push(item);
      if (label === "alpha") {
        const student = await provisionUsernameMember(tx, { householdId: household.id, username: "qa_student", displayName: "Synthetic QA student", password, role: "child" });
        fixture.student = { ...student, username: "qa_student" };
        const [course] = await tx.insert(schoolClasses).values({ householdId: household.id, teacherMemberId: member.id, name: "QA science", term: "Current synthetic term" }).returning();
        await tx.insert(schoolEnrollments).values({ classId: course.id, memberId: student.memberId, role: "student" });
        const [assignment] = await tx.insert(schoolAssignments).values({ classId: course.id, title: "QA plant observation", createdByUserId: user.id, visibility: "assigned", dueAt: new Date(Date.now() + 3 * 86400000) }).returning();
        fixture.course = { id: course.id, assignmentId: assignment.id };
      }
    }
  });
  const response = await fetch(`${process.env.QA_PROVIDER_URL}/__qa/fixtures`, { method: "POST", headers: { "x-qa-token": process.env.QA_TOKEN }, body: JSON.stringify(fixture) });
  if (!response.ok) throw new Error("Could not initialize provider fixture identities");
  await writeFile("/qa/fixtures.json", JSON.stringify(fixture));
  console.log("Seeded Alpha, Beta, Expired households and student; synthetic School, Health, private files and billing.");
} finally { await closeDb(db); }
