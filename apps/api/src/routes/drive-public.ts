import { Hono } from "hono";
import { hashPassword, verifyPassword } from "@whome/auth";
import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { driveObjects, driveShareTokens } from "@whome/db";
import { eq } from "drizzle-orm";
import { filenameFromDriveKey } from "../lib/drive.js";
import { contentTypeFromKey, getObjectBuffer } from "../lib/s3.js";

export function drivePublicRoutes(db: Database, env: Env) {
  const app = new Hono();

  if (!env.DRIVE_PUBLIC_SHARES_ENABLED) {
    app.get("/:token", () => new Response("Not found", { status: 404 }));
    return app;
  }

  app.get("/:token", async (c) => {
    const token = c.req.param("token")?.trim();
    if (!token) return c.json({ error: "not_found" }, 404);

    const [row] = await db
      .select({
        tokenId: driveShareTokens.id,
        expiresAt: driveShareTokens.expiresAt,
        revokedAt: driveShareTokens.revokedAt,
        passwordHash: driveShareTokens.passwordHash,
        object: driveObjects,
      })
      .from(driveShareTokens)
      .innerJoin(driveObjects, eq(driveShareTokens.driveObjectId, driveObjects.id))
      .where(eq(driveShareTokens.token, token))
      .limit(1);

    if (!row || row.revokedAt) return c.json({ error: "not_found" }, 404);
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      return c.json({ error: "expired" }, 410);
    }
    if (row.object.kind !== "file" || !row.object.s3Key) {
      return c.json({ error: "not_a_file" }, 400);
    }

    if (row.passwordHash) {
      const supplied =
        c.req.query("password")?.trim() ||
        c.req.header("X-Share-Password")?.trim() ||
        "";
      if (!supplied) {
        return c.json({ error: "password_required" }, 401);
      }
      const valid = await verifyPassword({ hash: row.passwordHash, password: supplied });
      if (!valid) return c.json({ error: "invalid_password" }, 403);
    }

    const buf = await getObjectBuffer(env, row.object.s3Key);
    if (!buf) return c.json({ error: "not_found" }, 404);

    const contentType = row.object.contentType?.trim() || contentTypeFromKey(row.object.s3Key);
    const filename = filenameFromDriveKey(row.object.s3Key);
    return new Response(buf, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  });

  return app;
}

export { hashPassword as hashSharePassword };
