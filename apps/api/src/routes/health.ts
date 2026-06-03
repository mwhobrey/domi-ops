import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Database } from "@whome/db";

export function healthRoutes(db: Database) {
  const app = new Hono();

  app.get("/health", async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "degraded", db: false }, 503);
    }
  });

  return app;
}
