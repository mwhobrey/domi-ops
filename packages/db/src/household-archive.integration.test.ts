import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { decryptSensitive, encryptSensitive } from "@domi-ops/crypto";
import { baAccounts, closeDb, createDb, driveFolders, driveObjects, goalMilestones, goals, healthEvents, householdMembers, households, householdSubscriptions, schoolAssignments, schoolClasses, users, withHouseholdContext, withSystemContext, type Database } from "./index.js";
import { exportHouseholdArchive, restoreHouseholdArchive, type ArchiveObjectStore } from "./household-archive.js";
const sourceUrl = process.env.HOSTED_TEST_DATABASE_URL, targetUrl = process.env.HOSTED_ARCHIVE_RESTORE_TEST_DATABASE_URL;
const sourceKey = "source-key-for-private-household-fixtures-only", targetKey = "different-target-encryption-key-for-fixtures", archiveKey = "separate-transfer-key-for-one-archive-only";
(sourceUrl && targetUrl ? describe : describe.skip)("encrypted household archive restore rehearsal", () => {
  let source: Database, target: Database, directory: string, root: string;
  const hh: string[] = [], userIds: string[] = [], memberIds: string[] = [];
  const bodies = new Map<string, Buffer>(), restored = new Map<string, Buffer>(), reads: string[] = [];
  const store: ArchiveObjectStore = {
    async read(key) { reads.push(key); const body = bodies.get(key); if (!body) throw new Error("missing file"); return { body: (async function* () { yield body.subarray(0, 3); yield body.subarray(3); })(), contentType: "text/plain" }; },
    async write(key, body) { const chunks: Buffer[] = []; for await (const chunk of body) chunks.push(Buffer.from(chunk)); restored.set(key, Buffer.concat(chunks)); },
    async assertEmpty() { if (restored.size) throw new Error("Object namespace is not empty"); },
  };
  beforeAll(async () => {
    if (sourceUrl === targetUrl) throw new Error("Restore rehearsal requires a separate empty database");
    source = createDb(sourceUrl!); target = createDb(targetUrl!);
    root = await mkdtemp(join(tmpdir(), "domi-archive-rehearsal-")); directory = join(root, "archive");
    for (let i = 0; i < 2; i++) await withSystemContext(source, async (tx) => {
      const [h] = await tx.insert(households).values({ name: `archive-${randomUUID()}`, tier: "hosted_starter", storageQuotaBytes: 1000 }).returning(); hh.push(h.id);
      const [u] = await tx.insert(users).values({ username: `archive-${randomUUID()}`, email: `archive-${randomUUID()}@example.test` }).returning(); userIds.push(u.id);
      const [m] = await tx.insert(householdMembers).values({ householdId: h.id, userId: u.id, role: "owner", name: "Private synthetic person", avatarKey: `avatars/${h.id}/photo.txt` }).returning(); memberIds.push(m.id);
      await tx.insert(baAccounts).values([{ userId: u.id, accountId: u.id, providerId: "credential", password: "synthetic-password-hash" }, { userId: u.id, accountId: randomUUID(), providerId: "google", accessToken: "synthetic-provider-token-must-not-transfer" }]);
      await tx.insert(householdSubscriptions).values({ householdId: h.id, modulesEntitled: '["core"]', stripeCustomerId: `cus_${randomUUID()}`, status: "active" });
      await withHouseholdContext(tx, h.id, async (tx) => {
      await tx.insert(healthEvents).values({ householdId: h.id, memberId: m.id, title: encryptSensitive("Synthetic private health title", sourceKey), visibility: "private", createdByUserId: u.id });
      const [folder] = await tx.insert(driveFolders).values({ householdId: h.id, name: "Parent" }).returning();
      const [child] = await tx.insert(driveFolders).values({ householdId: h.id, parentId: folder.id, name: "Child" }).returning();
      await tx.insert(driveObjects).values({ householdId: h.id, folderId: child.id, kind: "file", title: "Private synthetic file", visibility: "private", createdByUserId: u.id, s3Key: `drive/${h.id}/private.txt`, byteSize: 18 });
      const [g] = await tx.insert(goals).values({ householdId: h.id, ownerMemberId: m.id, title: "Synthetic goal" }).returning();
      await tx.insert(goalMilestones).values({ goalId: g.id, threshold: 1, title: "Step" });
      const [cl] = await tx.insert(schoolClasses).values({ householdId: h.id, name: "Synthetic class", teacherMemberId: m.id }).returning();
      await tx.insert(schoolAssignments).values({ classId: cl.id, title: "Synthetic assignment", createdByUserId: u.id });
      bodies.set(`avatars/${h.id}/photo.txt`, Buffer.from(`avatar-${i}-synthetic`)); bodies.set(`drive/${h.id}/private.txt`, Buffer.from(`private-file-${i}-synthetic`));
      });
    });
  });
  afterAll(async () => {
    for (const db of [source, target]) if (db) {
      await withSystemContext(db, async (tx) => {
        if (hh.length) await tx.delete(households).where(inArray(households.id, hh));
        if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
      }); await closeDb(db);
    }
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("exports one household and files without plaintext data, identity tokens or service keys", async () => {
    const receipt = await exportHouseholdArchive({ db: source, householdId: hh[0], directory, store, encryptionKey: sourceKey, archiveKey });
    expect(receipt.files).toBe(2); expect(reads.every((k) => k.includes(hh[0]))).toBe(true);
    const encoded = await readFile(join(directory, "manifest.enc.json"), "utf8");
    for (const secret of [hh[0], hh[1], userIds[0], "Private synthetic", "Synthetic private health", sourceKey, targetKey, archiveKey, "synthetic-provider-token"]) expect(encoded).not.toContain(secret);
    await expect(exportHouseholdArchive({ db: source, householdId: hh[0], directory, store, encryptionKey: sourceKey, archiveKey })).rejects.toThrow();
  });
  it("validates every encrypted file before writes and refuses wrong keys and damage", async () => {
    const input = { db: target, directory, store, encryptionKey: targetKey, archiveKey };
    await expect(restoreHouseholdArchive({ ...input, archiveKey: "wrong-transfer-key-with-more-than-32-bytes" })).rejects.toThrow();
    const dry = await restoreHouseholdArchive(input); expect(dry.applied).toBe(false); expect(restored.size).toBe(0);
    const file = (await readdir(directory)).find((f) => f.endsWith(".bin"))!;
    const path = join(directory, file), original = await readFile(path), corrupt = Buffer.from(original); corrupt[0] ^= 1;
    await writeFile(path, corrupt);
    await expect(restoreHouseholdArchive({ ...input, apply: true })).rejects.toThrow(); expect(restored.size).toBe(0);
    await writeFile(path, original);
  });
  it("restores private relations, hierarchy and health encryption with a new key, then refuses overwrite", async () => {
    const input = { db: target, directory, store, encryptionKey: targetKey, archiveKey, apply: true };
    expect((await restoreHouseholdArchive(input)).applied).toBe(true);
    await withSystemContext(target, (systemTx) => withHouseholdContext(systemTx, hh[0], async (tx) => {
      const all = await tx.select().from(households); expect(all).toHaveLength(1); expect(all[0]).toMatchObject({ id: hh[0], tier: "self_host", storageQuotaBytes: null, telemetryOptIn: false });
      expect(await tx.select().from(users)).toHaveLength(1);
      const accounts = await tx.select().from(baAccounts); expect(accounts).toHaveLength(1); expect(accounts[0]).toMatchObject({ providerId: "credential", password: "synthetic-password-hash", accessToken: null });
      expect(await tx.select().from(householdSubscriptions)).toHaveLength(0);
      const [health] = await tx.select().from(healthEvents); expect(health.visibility).toBe("private"); expect(decryptSensitive(health.title, targetKey)).toBe("Synthetic private health title"); expect(() => decryptSensitive(health.title, sourceKey)).toThrow();
      expect(await tx.select().from(driveFolders)).toHaveLength(2);
      expect((await tx.select().from(driveObjects))[0].visibility).toBe("private");
      expect(await tx.select().from(goals)).toHaveLength(1); expect(await tx.select().from(schoolAssignments)).toHaveLength(1);
    }));
    expect(restored.size).toBe(2); for (const [key, bytes] of restored) expect(bytes).toEqual(bodies.get(key));
    await withHouseholdContext(target, hh[1], async (tx) => expect(await tx.select().from(healthEvents).where(eq(healthEvents.householdId, hh[0]))).toHaveLength(0));
    await expect(restoreHouseholdArchive(input)).rejects.toThrow(/not empty/);
  });
});
