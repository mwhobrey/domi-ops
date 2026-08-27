import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { createS3Client, ensureS3ReadyOnce, publicObjectUrl } from "../lib/s3.js";
import { browserUploadPutUrl } from "../lib/upload-token.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

const PRESIGN_EXPIRY_SEC = 15 * 60;

/** School artifact upload to S3/MinIO via presigned PutObject */
export function schoolUploadRoutes(_db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.post("/presign", async (c) => {
    const auth = c.get("auth")!;
    if (!createS3Client(env) || !env.S3_BUCKET) {
      return c.json({ error: "s3_not_configured" }, 503);
    }
    const body = await c.req.json<{ filename: string; contentType?: string }>();
    if (!body.filename?.trim()) {
      return c.json({ error: "filename_required" }, 400);
    }
    try {
      await ensureS3ReadyOnce(env);
    } catch {
      return c.json({ error: "s3_not_configured" }, 503);
    }
    const safe = body.filename.replace(/[^\w.\-]+/g, "_").slice(0, 200);
    const key = `school/${auth.householdId}/${Date.now()}-${safe}`;
    const contentType = body.contentType?.trim() || "application/octet-stream";

    const uploadId = randomUUID();
    const uploadUrl = browserUploadPutUrl(
      env,
      {
        uploadId,
        key,
        householdId: auth.householdId,
        memberId: auth.memberId,
        contentType,
        maxBytes: null,
        public: true,
      },
      PRESIGN_EXPIRY_SEC,
    );
    const publicUrl = publicObjectUrl(env, key);

    return c.json({ uploadUrl, key, publicUrl });
  });

  return app;
}
