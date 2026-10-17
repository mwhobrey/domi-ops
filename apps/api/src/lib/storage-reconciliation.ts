import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { browserUploads, driveObjects, households, schoolAssignmentMaterials, schoolSubmissionArtifacts, schoolSubmissions, shoppingTrips, type Database } from "@domi-ops/db";
import type { Env } from "@domi-ops/config";
import { createS3Client } from "./s3.js";

/** Reconcile referenced legacy files and existing charged uploads. Unknown orphan
 * objects are inventoried separately; never infer their ownership from byte counts. */
export async function reconcileHouseholdStorage(db: Database, env: Env, householdId: string, apply = false) {
  const client = createS3Client(env); if (!client || !env.S3_BUCKET) throw new Error("s3_not_configured");
  try { return await db.transaction(async (tx) => {
    const [household] = await tx.select().from(households).where(eq(households.id, householdId)).for("update");
    if (!household) throw new Error("household_not_found");
    type Ref = { key: string; purpose: string; claimedBy: string };
    const refs = new Map<string, Ref>();
    const add = (key: string | null, purpose: string, claimedBy: string) => {
      if (!key) return;
      const allowed = purpose === "drive" ? `drive/${householdId}/` : purpose === "receipt" ? `households/${householdId}/shopping/receipts/` : `school/${householdId}/`;
      if (!key.startsWith(allowed) || key.includes("..")) throw new Error("legacy_foreign_file_reference_requires_review");
      const prior = refs.get(key);
      if (prior && (prior.purpose !== purpose || prior.claimedBy !== claimedBy)) throw new Error("legacy_shared_file_reference_requires_review");
      refs.set(key, { key, purpose, claimedBy });
    };
    for (const row of await tx.select().from(driveObjects).where(eq(driveObjects.householdId, householdId))) add(row.s3Key, "drive", row.id);
    for (const row of await tx.select({ key: schoolSubmissionArtifacts.s3Key, submissionId: schoolSubmissions.id }).from(schoolSubmissionArtifacts).innerJoin(schoolSubmissions, eq(schoolSubmissions.id, schoolSubmissionArtifacts.submissionId))) add(row.key, "school", row.submissionId);
    for (const row of await tx.select().from(schoolAssignmentMaterials)) for (const key of [row.snapshotS3Key, row.snapshotTextS3Key, row.snapshotJsonS3Key]) add(key, "school_snapshot", row.id);
    for (const row of await tx.select().from(shoppingTrips).where(eq(shoppingTrips.householdId, householdId))) add(row.receiptS3Key, "receipt", row.id);
    const existing = await tx.select().from(browserUploads).where(and(eq(browserUploads.householdId, householdId), ne(browserUploads.state, "issued"))).for("update");
    for (const row of existing) if (!refs.has(row.s3Key)) add(row.s3Key, row.purpose, row.claimedBy ?? "");
    let bytes = 0, backfilled = 0;
    for (const ref of refs.values()) {
      const object = await client.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: ref.key }));
      const size = object.ContentLength;
      if (!Number.isSafeInteger(size) || size! < 0) throw new Error("storage_size_unknown");
      bytes += size!; if (!Number.isSafeInteger(bytes)) throw new Error("storage_size_overflow");
      const prior = existing.find((row) => row.s3Key === ref.key);
      if (prior && refs.get(ref.key)?.claimedBy && (prior.purpose !== ref.purpose || prior.claimedBy !== ref.claimedBy)) throw new Error("storage_provenance_conflict");
      if (!prior) backfilled++;
      if (apply) {
        if (prior) await tx.update(browserUploads).set({ byteSize: size, contentType: object.ContentType ?? prior.contentType, maxBytes: Math.max(1, size!) }).where(eq(browserUploads.id, prior.id));
        else await tx.insert(browserUploads).values({ id: randomUUID(), householdId, memberId: null, purpose: ref.purpose, s3Key: ref.key, contentType: object.ContentType ?? "application/octet-stream", maxBytes: Math.max(1, size!), byteSize: size, state: "consumed", claimedBy: ref.claimedBy, expiresAt: new Date() });
      }
    }
    if (apply) await tx.update(households).set({ storageUsedBytes: bytes, driveQuotaWarnSentAt: null }).where(eq(households.id, householdId));
    return { applied: apply, householdId, previousBytes: household.storageUsedBytes, actualBytes: bytes, referencedOrChargedObjects: refs.size, provenanceBackfills: backfilled, avatarBytesExcluded: true };
  }); } finally { client.destroy(); }
}
