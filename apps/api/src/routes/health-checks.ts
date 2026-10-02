import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { healthChecks, householdMembers } from "@domi-ops/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { encryptHealthField, HealthEncryptionError } from "../lib/health-crypto.js";
import {
  hasHealthSegmentAccess,
  normalizeHealthVisibility,
  validateHealthShareMemberIds,
} from "../lib/health-access.js";
import {
  healthCheckVisibleWhere,
  removeCheckFromAllGroups,
  replaceHealthCheckShares,
} from "../lib/health-check-access.js";
import { recordCheckEnabledChange } from "../lib/health-check-pauses.js";
import { CheckScheduleError, normalizeCheckSchedule } from "../lib/health-check-schedule.js";
import { enrichHealthChecks } from "../lib/health-check-serialize.js";
import {
  CheckTemplateError,
  isCheckEventType,
  normalizeCheckTemplate,
  validateCheckDateRange,
} from "../lib/health-check-template.js";
import { parseMedSchedule } from "../lib/health-serialize.js";
import { isUuid, isUuidList } from "../lib/uuid.js";

type Auth = NonNullable<AppVariables["auth"]>;

const MAX_NAME_LENGTH = 200;
function encryptionErrorResponse(c: { json: (body: unknown, status?: number) => Response }, e: unknown) {
  if (e instanceof HealthEncryptionError) {
    return c.json({ error: "encryption_key_required", message: e.message }, 503);
  }
  return null;
}

function cleanOffsets(value: unknown): number[] {
  if (!Array.isArray(value)) return [0];
  return value.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
}

type ScheduleBody = {
  scheduleKind?: string;
  schedule?: {
    times?: string[];
    daysOfWeek?: number[];
    everyMinutes?: number;
    anchor?: string;
    fixedStartTime?: string;
    intervalFrom?: string;
    stop?: { mode?: string; maxDoses?: number; endTime?: string };
  };
};

/**
 * Scheduled health checks (WHO-382): "log vitals / pain / food / exercise at these times".
 * Siblings to medications with the same schedule shapes, visibility, shares and soft delete, but
 * permissions ride the `events` ACL segment (decided on WHO-382: no separate checks segment).
 *
 * `memberId` and `eventType` are immutable after create: group membership, logs and the
 * completion matching all key on them, so changing one means making a new check.
 */
export function healthCheckRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  /** The check if it exists, is not deleted, and the caller may see it; otherwise undefined. */
  async function loadVisibleCheck(auth: Auth, id: string) {
    if (!isUuid(id)) return undefined;
    const [row] = await db
      .select()
      .from(healthChecks)
      .where(and(eq(healthChecks.id, id), isNull(healthChecks.deletedAt), healthCheckVisibleWhere(db, auth)))
      .limit(1);
    return row;
  }

  /** Household visibility is read-only (WHO-339): writes need the creator or `events` write. */
  async function canWriteCheck(auth: Auth, row: typeof healthChecks.$inferSelect) {
    return (
      row.createdByUserId === auth.userId ||
      (await hasHealthSegmentAccess(db, auth, row.memberId, "events", "write"))
    );
  }

  app.get("/", async (c) => {
    const auth = c.get("auth")!;
    const memberId = c.req.query("memberId");
    if (memberId !== undefined && !isUuid(memberId)) return c.json({ error: "invalid_member" }, 400);
    const rows = await db
      .select()
      .from(healthChecks)
      .where(
        and(
          healthCheckVisibleWhere(db, auth),
          isNull(healthChecks.deletedAt),
          memberId ? eq(healthChecks.memberId, memberId) : undefined,
        ),
      )
      .orderBy(desc(healthChecks.createdAt));
    try {
      return c.json({ checks: await enrichHealthChecks(db, env, auth, rows) });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.get("/:id", async (c) => {
    const auth = c.get("auth")!;
    const row = await loadVisibleCheck(auth, c.req.param("id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    try {
      const [check] = await enrichHealthChecks(db, env, auth, [row]);
      return c.json({ check });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.post("/", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req
      .json<
        ScheduleBody & {
          memberId?: string;
          name?: string;
          eventType?: string;
          template?: unknown;
          reminderOffsets?: number[];
          startDate?: string | null;
          endDate?: string | null;
          enabled?: boolean;
          visibility?: string;
          sharedMemberIds?: string[];
        }
      >()
      .catch(() => null);

    if (
      !body ||
      !isUuid(body.memberId) ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > MAX_NAME_LENGTH ||
      (body.enabled !== undefined && typeof body.enabled !== "boolean") ||
      (body.sharedMemberIds !== undefined && !isUuidList(body.sharedMemberIds))
    ) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (!isCheckEventType(body.eventType)) return c.json({ error: "invalid_event_type" }, 400);

    const [member] = await db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(and(eq(householdMembers.id, body.memberId), eq(householdMembers.householdId, auth.householdId)))
      .limit(1);
    if (!member) return c.json({ error: "member_not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, body.memberId, "events", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }

    let template;
    let scheduleMeta;
    try {
      template = normalizeCheckTemplate(body.eventType, body.template);
      scheduleMeta = normalizeCheckSchedule(body);
    } catch (e) {
      if (e instanceof CheckTemplateError || e instanceof CheckScheduleError) {
        return c.json({ error: e.code }, 400);
      }
      throw e;
    }
    const dateError = validateCheckDateRange(body.startDate, body.endDate);
    if (dateError) return c.json({ error: dateError }, 400);

    try {
      const visibility = normalizeHealthVisibility(body.visibility);
      const [row] = await db
        .insert(healthChecks)
        .values({
          householdId: auth.householdId,
          memberId: body.memberId,
          name: encryptHealthField(body.name.trim(), env) ?? "",
          eventType: body.eventType,
          templateJson: encryptHealthField(JSON.stringify(template), env) ?? "{}",
          scheduleKind: scheduleMeta.scheduleKind,
          scheduleJson: scheduleMeta.scheduleJson,
          reminderOffsetsJson: JSON.stringify(cleanOffsets(body.reminderOffsets)),
          startDate: body.startDate ?? null,
          endDate: body.endDate ?? null,
          enabled: body.enabled ?? true,
          visibility,
          createdByUserId: auth.userId,
        })
        .returning();
      // Created paused: open a pause now so adherence doesn't count slots before it's resumed.
      await recordCheckEnabledChange(db, row.id, true, row.enabled);

      if (visibility === "private" && Array.isArray(body.sharedMemberIds)) {
        const shared = await validateHealthShareMemberIds(db, auth.householdId, body.sharedMemberIds, auth.memberId);
        await replaceHealthCheckShares(db, row.id, shared);
      }

      const [check] = await enrichHealthChecks(db, env, auth, [row]);
      return c.json({ check }, 201);
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.patch("/:id", async (c) => {
    const auth = c.get("auth")!;
    const existing = await loadVisibleCheck(auth, c.req.param("id"));
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (!(await canWriteCheck(auth, existing))) return c.json({ error: "forbidden" }, 403);

    const body = await c.req
      .json<
        ScheduleBody & {
          name?: string;
          template?: unknown;
          reminderOffsets?: number[];
          startDate?: string | null;
          endDate?: string | null;
          enabled?: boolean;
          visibility?: string;
          sharedMemberIds?: string[];
          memberId?: string;
          eventType?: string;
        }
      >()
      .catch(() => null);
    if (!body) return c.json({ error: "invalid_body" }, 400);

    if (body.memberId !== undefined && body.memberId !== existing.memberId) {
      return c.json({ error: "immutable_field", field: "memberId" }, 400);
    }
    if (body.eventType !== undefined && body.eventType !== existing.eventType) {
      return c.json({ error: "immutable_field", field: "eventType" }, 400);
    }
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      return c.json({ error: "invalid_body" }, 400);
    }
    // Before any write: a malformed list would otherwise blow up after the row is already updated.
    if (body.sharedMemberIds !== undefined && !isUuidList(body.sharedMemberIds)) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > MAX_NAME_LENGTH) {
        return c.json({ error: "invalid_body" }, 400);
      }
    }

    const patch: Partial<typeof healthChecks.$inferInsert> = { updatedAt: new Date() };
    try {
      if (body.template !== undefined) {
        // The DB CHECK forbids "medication", but the column type still allows it.
        if (!isCheckEventType(existing.eventType)) return c.json({ error: "invalid_event_type" }, 400);
        patch.templateJson =
          encryptHealthField(JSON.stringify(normalizeCheckTemplate(existing.eventType, body.template)), env) ?? "{}";
      }
      if (body.scheduleKind !== undefined || body.schedule !== undefined) {
        const scheduleMeta = normalizeCheckSchedule({
          scheduleKind: body.scheduleKind ?? existing.scheduleKind,
          schedule: body.schedule ?? parseMedSchedule(existing.scheduleJson),
        });
        patch.scheduleKind = scheduleMeta.scheduleKind;
        patch.scheduleJson = scheduleMeta.scheduleJson;
      }
    } catch (e) {
      if (e instanceof CheckTemplateError || e instanceof CheckScheduleError) {
        return c.json({ error: e.code }, 400);
      }
      throw e;
    }

    if (body.startDate !== undefined || body.endDate !== undefined) {
      const dateError = validateCheckDateRange(
        body.startDate !== undefined ? body.startDate : existing.startDate,
        body.endDate !== undefined ? body.endDate : existing.endDate,
      );
      if (dateError) return c.json({ error: dateError }, 400);
      if (body.startDate !== undefined) patch.startDate = body.startDate;
      if (body.endDate !== undefined) patch.endDate = body.endDate;
    }

    try {
      if (body.name !== undefined) patch.name = encryptHealthField(body.name.trim(), env) ?? "";
      if (body.reminderOffsets !== undefined) {
        patch.reminderOffsetsJson = JSON.stringify(cleanOffsets(body.reminderOffsets));
      }
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.visibility !== undefined) patch.visibility = normalizeHealthVisibility(body.visibility);

      const [row] = await db.update(healthChecks).set(patch).where(eq(healthChecks.id, existing.id)).returning();
      await recordCheckEnabledChange(db, row.id, existing.enabled, row.enabled);

      if (row.visibility === "household") {
        await replaceHealthCheckShares(db, row.id, []);
      } else if (body.sharedMemberIds !== undefined) {
        const shared = await validateHealthShareMemberIds(db, auth.householdId, body.sharedMemberIds, auth.memberId);
        await replaceHealthCheckShares(db, row.id, shared);
      }

      const [check] = await enrichHealthChecks(db, env, auth, [row]);
      return c.json({ check });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth")!;
    const existing = await loadVisibleCheck(auth, c.req.param("id"));
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (!(await canWriteCheck(auth, existing))) return c.json({ error: "forbidden" }, 403);
    // Soft delete (like WHO-338): logs keep their parent. Disabling it too keeps every
    // enabled-only path (glance, overlays, reminder scan) from needing its own deleted filter.
    const now = new Date();
    await db
      .update(healthChecks)
      .set({ deletedAt: now, enabled: false, updatedAt: now })
      .where(eq(healthChecks.id, existing.id));
    await removeCheckFromAllGroups(db, existing.id);
    return c.json({ ok: true });
  });

  return app;
}
