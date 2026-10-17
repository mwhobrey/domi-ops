import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { createS3Client, ensureS3ReadyOnce } from "../lib/s3.js";
import { issueBrowserUpload } from "../lib/browser-uploads.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";

const PRESIGN_EXPIRY_SEC = 15 * 60;

/** School artifact upload to S3/MinIO via presigned PutObject */
export function schoolUploadRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "school"));

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
    const uploadId = randomUUID();
    const key = `school/${auth.householdId}/${uploadId}-${safe}`;
    const contentType = body.contentType?.trim() || "application/octet-stream";

    const uploadUrl = await issueBrowserUpload(
      db, env,
      {
        uploadId,
        key,
        householdId: auth.householdId,
        memberId: auth.memberId,
        contentType,
        maxBytes: env.DRIVE_UPLOAD_MAX_BYTES,
      },
      "school",
      PRESIGN_EXPIRY_SEC,
    );

    return c.json({ uploadUrl, key });
  });

  return app;
}
