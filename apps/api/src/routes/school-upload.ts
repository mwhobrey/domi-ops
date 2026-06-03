import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Hono } from "hono";
import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

const PRESIGN_EXPIRY_SEC = 15 * 60;

function s3Client(env: Env): S3Client | null {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) return null;
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: env.S3_FORCE_PATH_STYLE ?? true,
  });
}

/** School artifact upload to S3/MinIO via presigned PutObject */
export function schoolUploadRoutes(_db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.post("/presign", async (c) => {
    const auth = c.get("auth")!;
    const client = s3Client(env);
    if (!client || !env.S3_BUCKET) {
      return c.json({ error: "s3_not_configured" }, 503);
    }
    const body = await c.req.json<{ filename: string; contentType?: string }>();
    if (!body.filename?.trim()) {
      return c.json({ error: "filename_required" }, 400);
    }
    const safe = body.filename.replace(/[^\w.\-]+/g, "_").slice(0, 200);
    const key = `school/${auth.householdId}/${Date.now()}-${safe}`;
    const contentType = body.contentType ?? "application/octet-stream";

    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: PRESIGN_EXPIRY_SEC });
    const publicUrl = env.S3_PUBLIC_URL ? `${env.S3_PUBLIC_URL}/${key}` : null;

    return c.json({ uploadUrl, key, publicUrl });
  });

  return app;
}
