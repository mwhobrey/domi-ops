import { Hono } from "hono";
import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

/** School artifact upload to S3/MinIO (v1: presigned URL stub) */
export function schoolUploadRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.post("/presign", async (c) => {
    const auth = c.get("auth")!;
    if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY) {
      return c.json({ error: "s3_not_configured" }, 503);
    }
    const body = await c.req.json<{ filename: string; contentType?: string }>();
    const key = `school/${auth.householdId}/${Date.now()}-${body.filename}`;
    return c.json({
      uploadUrl: `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`,
      publicUrl: env.S3_PUBLIC_URL
        ? `${env.S3_PUBLIC_URL}/${key}`
        : null,
      key,
      note: "Wire @aws-sdk/client-s3 PutObject presigner for production uploads",
    });
  });

  return app;
}
