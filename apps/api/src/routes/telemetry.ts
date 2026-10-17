import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { privateTelemetryFields, telemetryRoute } from "@domi-ops/config/diagnostics";
import { telemetryBugReports, telemetryEvents } from "@domi-ops/db";
import type { Database } from "@domi-ops/db";

/**
 * Unauthenticated by design — self-host instances have no session with this API, and
 * telemetry is collected specifically because the household hasn't otherwise connected
 * their instance to anything. Never touches households/users; nothing here can be
 * traced back to a specific family. See packages/db/src/schema/telemetry.ts.
 *
 * The collector bounds bodies and batch sizes. Deploy behind edge abuse controls;
 * this unauthenticated endpoint does not establish consent or caller identity.
 */

const MAX_EVENTS_PER_BATCH = 50;
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

export function telemetryRoutes(db: Database) {
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 64 * 1024 }));

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
      const fields = privateTelemetryFields(e);
      if (!anonId || !kind || !fields) return [];
      const deploymentMode =
        typeof e.deploymentMode === "string" && VALID_DEPLOYMENT_MODES.has(e.deploymentMode)
          ? e.deploymentMode
          : undefined;
      return [
        {
          anonId,
          kind: kind as "web_vital" | "error" | "usage",
          name: fields.name,
          value: fields.value,
          path: fields.path,
          deploymentMode: deploymentMode ?? null,
          appVersion: clampString(e.appVersion, 32) ?? null,
          metadata: fields.metadata,
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
      path: telemetryRoute(body.path),
    });

    return c.json({ ok: true });
  });

  return app;
}
