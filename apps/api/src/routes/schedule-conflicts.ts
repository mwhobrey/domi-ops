import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { computeScheduleConflicts } from "../lib/schedule-conflicts.js";
import type { CheckWindowInput } from "../lib/schedule-conflict-math.js";
import {
  MAX_DRIVE_BUFFER_MINUTES,
  ScheduleConflictInputError,
  isValidIsoDate,
  isValidTime,
  isValidTimeZone,
  parseDriveBufferMinutes,
} from "../lib/schedule-conflict-input.js";

function parseBufferQuery(raw: string | undefined): { ok: true; value: number | undefined } | { ok: false } {
  if (raw === undefined || raw === "") return { ok: true, value: undefined };
  const parsed = parseDriveBufferMinutes(Number(raw));
  return parsed.ok ? { ok: true, value: parsed.value ?? undefined } : { ok: false };
}

export function scheduleConflictRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "calendar_sync"));

  app.get("/check", async (c) => {
    const auth = c.get("auth")!;
    const bad = (message: string) => c.json({ error: "invalid_request", message }, 400);

    const mode = c.req.query("mode");
    const timeZone = c.req.query("timeZone") || undefined;
    if (timeZone && !isValidTimeZone(timeZone)) return bad("timeZone must be a valid IANA time zone");

    let input: CheckWindowInput;
    if (mode === "at") {
      const date = c.req.query("date");
      const time = c.req.query("time");
      if (!date || !time) return bad("date and time are required for mode=at");
      if (!isValidIsoDate(date)) return bad("date must be a valid YYYY-MM-DD date");
      if (!isValidTime(time)) return bad("time must be a valid HH:mm time");
      input = { mode: "at", date, time, timeZone };
    } else if (mode === "range") {
      const startDate = c.req.query("startDate");
      const startTime = c.req.query("startTime");
      const endTime = c.req.query("endTime");
      const endDate = c.req.query("endDate") || undefined;
      if (!startDate || !startTime || !endTime) {
        return bad("startDate, startTime, and endTime are required for mode=range");
      }
      if (!isValidIsoDate(startDate) || (endDate && !isValidIsoDate(endDate))) {
        return bad("dates must be valid YYYY-MM-DD dates");
      }
      if (!isValidTime(startTime) || !isValidTime(endTime)) return bad("times must be valid HH:mm times");
      input = { mode: "range", startDate, startTime, endDate, endTime, timeZone };
    } else {
      return bad("mode must be 'at' or 'range'");
    }

    const before = parseBufferQuery(c.req.query("bufferBeforeMinutes"));
    const after = parseBufferQuery(c.req.query("bufferAfterMinutes"));
    if (!before.ok || !after.ok) {
      return bad(`buffers must be whole minutes from 0 to ${MAX_DRIVE_BUFFER_MINUTES}`);
    }
    const adHocBuffer =
      before.value !== undefined || after.value !== undefined
        ? { beforeMinutes: before.value ?? 0, afterMinutes: after.value ?? 0 }
        : null;

    try {
      return c.json(await computeScheduleConflicts(db, env, auth, input, adHocBuffer));
    } catch (err) {
      if (err instanceof ScheduleConflictInputError) return bad(err.message);
      throw err;
    }
  });

  return app;
}
