import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { computeScheduleConflicts } from "../lib/schedule-conflicts.js";
import type { CheckWindowInput } from "../lib/schedule-conflict-math.js";

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : undefined;
}

export function scheduleConflictRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "calendar_sync"));

  app.get("/check", async (c) => {
    const auth = c.get("auth")!;
    const mode = c.req.query("mode");
    const timeZone = c.req.query("timeZone") || undefined;

    let input: CheckWindowInput;
    if (mode === "at") {
      const date = c.req.query("date");
      const time = c.req.query("time");
      if (!date || !time) {
        return c.json({ error: "invalid_request", message: "date and time are required for mode=at" }, 400);
      }
      input = { mode: "at", date, time, timeZone };
    } else if (mode === "range") {
      const startDate = c.req.query("startDate");
      const startTime = c.req.query("startTime");
      const endTime = c.req.query("endTime");
      const endDate = c.req.query("endDate") || undefined;
      if (!startDate || !startTime || !endTime) {
        return c.json(
          { error: "invalid_request", message: "startDate, startTime, and endTime are required for mode=range" },
          400,
        );
      }
      input = { mode: "range", startDate, startTime, endDate, endTime, timeZone };
    } else {
      return c.json({ error: "invalid_request", message: "mode must be 'at' or 'range'" }, 400);
    }

    const beforeMinutes = parseOptionalInt(c.req.query("bufferBeforeMinutes"));
    const afterMinutes = parseOptionalInt(c.req.query("bufferAfterMinutes"));
    const adHocBuffer =
      beforeMinutes !== undefined || afterMinutes !== undefined
        ? { beforeMinutes: beforeMinutes ?? 0, afterMinutes: afterMinutes ?? 0 }
        : null;

    const result = await computeScheduleConflicts(db, env, auth, input, adHocBuffer);
    return c.json(result);
  });

  return app;
}
