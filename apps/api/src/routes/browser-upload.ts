import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { isDriveQuotaEnforced } from "@domi-ops/config";
import { browserUploads, households, type Database } from "@domi-ops/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { readBoundedUpload } from "../lib/browser-uploads.js";
import { requireAuth, type AppVariables } from "../middleware/auth.js";
import { putObject } from "../lib/s3.js";
import { verifyBrowserUploadToken } from "../lib/upload-token.js";

/** Token-authenticated browser PUT → internal MinIO (avoids public S3 / Caddy /s3). */
export function browserUploadRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.put("/:uploadId", async (c) => {
    const secret = env.SESSION_SECRET;
    if (!secret) return c.json({ error: "server_misconfigured" }, 503);

    const uploadId = c.req.param("uploadId");
    const token = c.req.query("token");
    if (!token) return c.json({ error: "token_required" }, 400);

    let grant;
    try {
      grant = verifyBrowserUploadToken(secret, token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "invalid_token";
      return c.json({ error: msg }, 403);
    }
    const auth = c.get("auth")!;
    if (grant.uploadId !== uploadId || grant.householdId !== auth.householdId || grant.memberId !== auth.memberId) {
      return c.json({ error: "invalid_token" }, 403);
    }
    if (!Number.isSafeInteger(grant.maxBytes) || grant.maxBytes! < 0 || grant.maxBytes! > env.DRIVE_UPLOAD_MAX_BYTES) {
      return c.json({ error: "invalid_token" }, 403);
    }
    let buf: Buffer;
    try {
      buf = await readBoundedUpload(c.req.raw, grant.maxBytes!);
    } catch {
      return c.json({ error: "file_too_large" }, 413);
    }
    try {
      const result = await db.transaction(async (tx) => {
        // Lock a household first everywhere quota is changed. Parallel uploads serialize here.
        const [household] = await tx.select().from(households).where(eq(households.id, auth.householdId)).for("update");
        const [upload] = await tx.select().from(browserUploads).where(and(
          eq(browserUploads.id, uploadId), eq(browserUploads.householdId, auth.householdId),
          eq(browserUploads.memberId, auth.memberId), eq(browserUploads.state, "issued"),
          gt(browserUploads.expiresAt, new Date()),
        )).for("update");
        if (!household || !upload || upload.s3Key !== grant.key || upload.maxBytes !== grant.maxBytes || upload.contentType !== grant.contentType) return "invalid_upload";
        if (isDriveQuotaEnforced(env) && household.storageQuotaBytes != null && household.storageUsedBytes + buf.length > household.storageQuotaBytes) return "quota_exceeded";
        // The signed/server-owned type wins over an arbitrary request Content-Type.
        await putObject(env, upload.s3Key, buf, upload.contentType);
        await tx.update(browserUploads).set({ state: "uploaded", byteSize: buf.length }).where(eq(browserUploads.id, upload.id));
        await tx.update(households).set({ storageUsedBytes: sql`${households.storageUsedBytes} + ${buf.length}` }).where(eq(households.id, auth.householdId));
        return "ok";
      });
      if (result !== "ok") return c.json({ error: result }, result === "quota_exceeded" ? 400 : 409);
    } catch {
      return c.json({ error: "upload_failed" }, 500);
    }
    return c.body(null, 204);
  });

  return app;
}
