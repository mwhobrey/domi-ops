import { Hono } from "hono";
import { telemetryBugReports, telemetryEvents } from "@domi-ops/db";
import type { Database } from "@domi-ops/db";

/**
 * Unauthenticated by design — self-host instances have no session with this API, and
 * telemetry is collected specifically because the household hasn't otherwise connected
 * their instance to anything. Never touches households/users; nothing here can be
 * traced back to a specific family. See packages/db/src/schema/telemetry.ts.
 *
 * No rate limiting yet — there's no rate-limit infra anywhere in this codebase today
 * (checked; the same gap already flagged for POST /api/billing/checkout). Acceptable
 * for now given volume; revisit before this sees real public traffic at scale.
 */

const MAX_EVENTS_PER_BATCH = 50;
const MAX_STRING_LEN = 256;
const MAX_MESSAGE_LEN = 4000;
const VALID_KINDS = new Set(["web_vital", "error", "usage"]);
const VALID_DEPLOYMENT_MODES = new Set(["single", "shared", "dedicated"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clampString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

/**
 * anon_id is a uuid column — a malformed value found this the hard way (unhandled 500,
 * raw Postgres error) rather than the intended clean 400. Validate the shape before it
 * ever reaches a query.
 */
function clampUuid(value: unknown): string | undefined {
  const s = clampString(value, 36);
  return s && UUID_RE.test(s) ? s : undefined;
}

function clampMetadata(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (count >= 10) break;
    if (typeof v === "string") {
      out[key.slice(0, 64)] = v.slice(0, 128);
      count += 1;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out[key.slice(0, 64)] = v;
      count += 1;
    } else if (typeof v === "boolean") {
      out[key.slice(0, 64)] = v;
      count += 1;
    }
  }
  return count > 0 ? out : undefined;
}

export function telemetryRoutes(db: Database) {
  const app = new Hono();

  app.post("/events", async (c) => {
    let body: { events?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    if (!Array.isArray(body.events) || body.events.length === 0) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const rows = body.events.slice(0, MAX_EVENTS_PER_BATCH).flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const e = raw as Record<string, unknown>;
      const anonId = clampUuid(e.anonId);
      const kind = typeof e.kind === "string" && VALID_KINDS.has(e.kind) ? e.kind : undefined;
      const name = clampString(e.name, MAX_STRING_LEN);
      if (!anonId || !kind || !name) return [];
      const deploymentMode =
        typeof e.deploymentMode === "string" && VALID_DEPLOYMENT_MODES.has(e.deploymentMode)
          ? e.deploymentMode
          : undefined;
      return [
        {
          anonId,
          kind: kind as "web_vital" | "error" | "usage",
          name,
          value: typeof e.value === "number" && Number.isFinite(e.value) ? Math.round(e.value) : null,
          path: clampString(e.path, MAX_STRING_LEN) ?? null,
          deploymentMode: deploymentMode ?? null,
          appVersion: clampString(e.appVersion, 32) ?? null,
          metadata: clampMetadata(e.metadata) ?? null,
        },
      ];
    });

    if (rows.length === 0) {
      return c.json({ error: "no_valid_events" }, 400);
    }

    await db.insert(telemetryEvents).values(rows);
    return c.json({ ok: true, accepted: rows.length });
  });

  app.post("/bug-report", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const message = clampString(body.message, MAX_MESSAGE_LEN);
    const anonId = clampUuid(body.anonId);
    if (!message || !anonId) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const deploymentMode =
      typeof body.deploymentMode === "string" && VALID_DEPLOYMENT_MODES.has(body.deploymentMode)
        ? body.deploymentMode
        : undefined;

    await db.insert(telemetryBugReports).values({
      anonId,
      message,
      email: clampString(body.email, 320) ?? null,
      deploymentMode: deploymentMode ?? null,
      appVersion: clampString(body.appVersion, 32) ?? null,
      path: clampString(body.path, MAX_STRING_LEN) ?? null,
    });

    return c.json({ ok: true });
  });

  return app;
}
