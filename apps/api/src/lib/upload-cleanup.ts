import { and, eq, exists, lt, ne, not, or, sql } from "drizzle-orm";
import { browserUploads, driveObjects, households, schoolAssignmentMaterials, schoolSubmissionArtifacts, shoppingTrips, type Database } from "@domi-ops/db";
import type { Env } from "@domi-ops/config";
import { deleteObject } from "./s3.js";

/** Tenant-scoped maintenance. Keep failed/uncertain deletions charged and retryable. */
export async function cleanupAbandonedUploads(db: Database, env: Env, householdId: string, cutoff: Date, apply = false) {
  return db.transaction(async (tx) => {
    await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("update");
    const rows = await tx.select().from(browserUploads).where(and(
      eq(browserUploads.householdId, householdId), lt(browserUploads.expiresAt, cutoff),
      or(ne(browserUploads.state, "consumed"),
        and(eq(browserUploads.purpose, "drive"), not(exists(tx.select({ id: driveObjects.id }).from(driveObjects).where(eq(driveObjects.s3Key, browserUploads.s3Key))))),
        and(eq(browserUploads.purpose, "school"), not(exists(tx.select({ id: schoolSubmissionArtifacts.id }).from(schoolSubmissionArtifacts).where(eq(schoolSubmissionArtifacts.s3Key, browserUploads.s3Key))))),
        and(eq(browserUploads.purpose, "receipt"), not(exists(tx.select({ id: shoppingTrips.id }).from(shoppingTrips).where(eq(shoppingTrips.receiptS3Key, browserUploads.s3Key))))),
        and(eq(browserUploads.purpose, "school_snapshot"), not(exists(tx.select({ id: schoolAssignmentMaterials.id }).from(schoolAssignmentMaterials).where(and(sql`${schoolAssignmentMaterials.id}::text = ${browserUploads.claimedBy}`, or(eq(schoolAssignmentMaterials.snapshotS3Key, browserUploads.s3Key), eq(schoolAssignmentMaterials.snapshotTextS3Key, browserUploads.s3Key), eq(schoolAssignmentMaterials.snapshotJsonS3Key, browserUploads.s3Key))))))),
      ),
    )).for("update");
    if (apply) {
      if (!env.S3_ENDPOINT || !env.S3_BUCKET) throw new Error("s3_not_configured");
      for (const row of rows) {
        await deleteObject(env, row.s3Key);
        await tx.delete(browserUploads).where(eq(browserUploads.id, row.id));
        if (row.byteSize) await tx.update(households).set({
          storageUsedBytes: sql`greatest(0, ${households.storageUsedBytes} - ${row.byteSize})`,
        }).where(eq(households.id, householdId));
      }
    }
    return rows.map(({ id, state, byteSize }) => ({ id, state, byteSize }));
  });
}
