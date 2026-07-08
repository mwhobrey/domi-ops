import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { putObject } from "../lib/s3.js";
import { verifyBrowserUploadToken } from "../lib/upload-token.js";

/** Token-authenticated browser PUT → internal MinIO (avoids public S3 / Caddy /s3). */
export function browserUploadRoutes(env: Env) {
  const app = new Hono();

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
    if (grant.uploadId !== uploadId) return c.json({ error: "invalid_token" }, 403);

    const buf = Buffer.from(await c.req.arrayBuffer());
    if (grant.maxBytes != null && buf.length > grant.maxBytes) {
      return c.json({ error: "file_too_large" }, 400);
    }

    const contentType = c.req.header("content-type")?.trim() || grant.contentType;
    try {
      await putObject(env, grant.key, buf, contentType);
    } catch {
      return c.json({ error: "upload_failed" }, 500);
    }
    return c.body(null, 204);
  });

  return app;
}
