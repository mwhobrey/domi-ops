import type { AuthContext } from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";
import { browserUploads, households, type Database } from "@domi-ops/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { deleteObject } from "./s3.js";
import { browserUploadPutUrl, type BrowserUploadGrant } from "./upload-token.js";

export async function issueBrowserUpload(
  db: Database, env: Env, grant: Omit<BrowserUploadGrant, "exp" | "public">,
  purpose: "drive" | "school" | "receipt", expiresInSec = 900,
) {
  if (!Number.isSafeInteger(grant.maxBytes) || grant.maxBytes! < 0) throw new Error("invalid_upload_limit");
  await db.insert(browserUploads).values({
    id: grant.uploadId, householdId: grant.householdId, memberId: grant.memberId,
    purpose, s3Key: grant.key, contentType: grant.contentType,
    maxBytes: grant.maxBytes!, expiresAt: new Date(Date.now() + expiresInSec * 1000),
  });
  return browserUploadPutUrl(env, grant, expiresInSec);
}

/** Atomic single claim. Call within the same transaction as the referencing insert. */
export async function claimBrowserUpload(
  db: Database, auth: AuthContext, key: string, purpose: "drive" | "school" | "receipt", claimedBy: string,
) {
  await db.select({ id: households.id }).from(households).where(eq(households.id, auth.householdId)).for("update");
  const [upload] = await db.update(browserUploads).set({ state: "consumed", claimedBy }).where(and(
    eq(browserUploads.householdId, auth.householdId), eq(browserUploads.memberId, auth.memberId),
    eq(browserUploads.s3Key, key), eq(browserUploads.purpose, purpose),
    eq(browserUploads.state, "uploaded"), gt(browserUploads.expiresAt, new Date()),
  )).returning();
  return upload ?? null;
}

/** Delete only a proven reference, never a caller-supplied storage key. */
export async function releaseBrowserUpload(db: Database, env: Env, householdId: string, key: string, claimedBy: string) {
  await db.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("update");
  const [upload] = await db.select().from(browserUploads).where(and(
    eq(browserUploads.householdId, householdId), eq(browserUploads.s3Key, key),
    eq(browserUploads.state, "consumed"), eq(browserUploads.claimedBy, claimedBy),
  )).for("update");
  if (!upload) return false;
  await deleteObject(env, upload.s3Key);
  await db.delete(browserUploads).where(eq(browserUploads.id, upload.id));
  await db.update(households).set({ storageUsedBytes: sql`greatest(0, ${households.storageUsedBytes} - ${upload.byteSize ?? 0})` }).where(eq(households.id, householdId));
  return true;
}

/** Read incrementally, refusing a body as soon as its bound is crossed. */
export async function readBoundedUpload(request: Request, maxBytes: number): Promise<Buffer> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error("file_too_large");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("file_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
