import { randomUUID } from "node:crypto";
import type { Env } from "@domi-ops/config";
import { isDriveQuotaEnforced } from "@domi-ops/config";
import { browserUploads, households, type Database } from "@domi-ops/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { putObject } from "./s3.js";

/** Account deterministic generated snapshot keys as a batch, including safe retries. */
export async function storeSchoolSnapshots(db: Database, env: Env, householdId: string, materialId: string, files: { key: string; body: Buffer; contentType: string }[]) {
  if (!files.length) return;
  if (files.some((file) => file.body.length > env.DRIVE_UPLOAD_MAX_BYTES)) throw new Error("file_too_large");
  await db.transaction(async (tx) => {
    const [household] = await tx.select().from(households).where(eq(households.id, householdId)).for("update");
    if (!household) throw new Error("household_not_found");
    const existing = await tx.select().from(browserUploads).where(and(eq(browserUploads.householdId, householdId), inArray(browserUploads.s3Key, files.map((file) => file.key)))).for("update");
    if (existing.some((row) => row.purpose !== "school_snapshot" || row.claimedBy !== materialId)) throw new Error("storage_reference_conflict");
    const delta = files.reduce((sum, file) => sum + file.body.length, 0) - existing.reduce((sum, row) => sum + (row.byteSize ?? 0), 0);
    if (isDriveQuotaEnforced(env) && household.storageQuotaBytes != null && household.storageUsedBytes + delta > household.storageQuotaBytes) throw new Error("quota_exceeded");
    for (const file of files) {
      await putObject(env, file.key, file.body, file.contentType);
      const previous = existing.find((row) => row.s3Key === file.key);
      const values = { contentType: file.contentType, maxBytes: file.body.length, byteSize: file.body.length };
      if (previous) await tx.update(browserUploads).set(values).where(eq(browserUploads.id, previous.id));
      else await tx.insert(browserUploads).values({ id: randomUUID(), householdId, memberId: null, purpose: "school_snapshot", s3Key: file.key, ...values, state: "consumed", claimedBy: materialId, expiresAt: new Date() });
    }
    await tx.update(households).set({ storageUsedBytes: sql`greatest(0, ${households.storageUsedBytes} + ${delta})` }).where(eq(households.id, householdId));
  });
}
