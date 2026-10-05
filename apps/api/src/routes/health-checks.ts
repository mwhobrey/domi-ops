import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import {
  datesBetween,
  loadCheckSlotStatuses,
  resolveAlertTimeZone,
  todayIsoDateInTz,
} from "@domi-ops/calendar-sync";
import type { Database } from "@domi-ops/db";
import { healthCheckLogs, healthChecks, healthEvents, householdMembers } from "@domi-ops/db";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { encryptHealthField, HealthEncryptionError } from "../lib/health-crypto.js";
import {
  hasHealthSegmentAccess,
  healthEventVisibleWhere,
  normalizeHealthVisibility,
  validateHealthShareMemberIds,
} from "../lib/health-access.js";
import {
  healthCheckVisibleWhere,
  removeCheckFromAllGroups,
  replaceHealthCheckShares,
} from "../lib/health-check-access.js";
import {
  RecordCheckError,
  deleteCheckLog,
  editCheckLog,
  recordCheck,
  type RecordCheckErrorCode,
} from "../lib/health-check-logging.js";
import { recordCheckEnabledChange } from "../lib/health-check-pauses.js";
import { lockCheckQuota } from "../lib/health-check-quota.js";
import { CheckScheduleError, normalizeCheckSchedule, normalizeReminderOffsets } from "../lib/health-check-schedule.js";
import { enrichHealthChecks } from "../lib/health-check-serialize.js";
import {
  CheckTemplateError,
  isCheckEventType,
  isIsoDate,
  normalizeCheckTemplate,
  validateCheckDateRange,
} from "../lib/health-check-template.js";
import { householdTimezone } from "../lib/household-time.js";
import { parseMedSchedule } from "../lib/health-serialize.js";
import { isUuid, isUuidList } from "../lib/uuid.js";

type Auth = NonNullable<AppVariables["auth"]>;

const MAX_NAME_LENGTH = 200;
/** Far above any real use (a handful per person); here so one person cannot grow the worker's load without limit. */
export const MAX_CHECKS_PER_MEMBER = 100;
/** Most local days one `/slots` request may cover. */
const MAX_SLOT_RANGE_DAYS = 35;
const MAX_LOG_NOTES_LENGTH = 2000;

/** HTTP status for each reason recordCheck can refuse a link. */
const RECORD_CHECK_STATUS: Record<RecordCheckErrorCode, 400 | 404 | 409> = {
  event_required: 400,
  event_not_allowed: 400,
  event_not_found: 404,
  event_member_mismatch: 400,
  event_type_mismatch: 400,
  event_already_used: 409,
  slot_taken: 409,
  event_in_use: 409,
};
function encryptionErrorResponse(c: { json: (body: unknown, status?: number) => Response }, e: unknown) {
  if (e instanceof HealthEncryptionError) {
    return c.json({ error: "encryption_key_required", message: e.message }, 503);
  }
  return null;
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

  /**
   * Where each slot of the caller's checks stands over a range of local days: `done`,
   * `skipped`, `due`, `overdue` or `upcoming` (WHO-384). Registered before `/:id`.
   *
   * An entry logged outside the check still completes a slot it is within 30 minutes of; a slot
   * answered through `POST /:id/log` counts however far off it was. The status reflects every
   * entry of the person, but `eventId` is only returned for entries the caller may open, so this
   * never reveals one they can't. Days are in the `x-client-timezone` header's zone (else
   * `?timezone=`, else the household's), because that is the zone the person is looking at.
   */
  app.get("/slots", async (c) => {
    const auth = c.get("auth")!;
    const memberId = c.req.query("memberId");
    const checkId = c.req.query("checkId");
    if (memberId !== undefined && !isUuid(memberId)) return c.json({ error: "invalid_member" }, 400);
    if (checkId !== undefined && !isUuid(checkId)) return c.json({ error: "invalid_check" }, 400);

    const timeZone = resolveAlertTimeZone({
      deviceTimezone: c.req.header("x-client-timezone") ?? c.req.query("timezone"),
      householdTimezone: await householdTimezone(db, auth.householdId),
    });
    const now = new Date();
    const from = c.req.query("from") ?? todayIsoDateInTz(timeZone);
    const to = c.req.query("to") ?? from;
    if (!isIsoDate(from) || !isIsoDate(to)) return c.json({ error: "invalid_date" }, 400);
    if (to < from) return c.json({ error: "end_before_start" }, 400);
    if (datesBetween(from, to).length > MAX_SLOT_RANGE_DAYS) return c.json({ error: "range_too_large" }, 400);

    const rows = await db
      .select()
      .from(healthChecks)
      .where(
        and(
          healthCheckVisibleWhere(db, auth),
          isNull(healthChecks.deletedAt),
          memberId ? eq(healthChecks.memberId, memberId) : undefined,
          checkId ? eq(healthChecks.id, checkId) : undefined,
        ),
      );

    try {
      const statuses = await loadCheckSlotStatuses(db, env, { checks: rows, from, to, timeZone, now });

      // Only name entries the caller is allowed to open.
      const linkedIds = [
        ...new Set([...statuses.values()].flat().map((r) => r.eventId).filter((id): id is string => id != null)),
      ];
      const openable = new Set<string>();
      if (linkedIds.length > 0) {
        const visible = await db
          .select({ id: healthEvents.id })
          .from(healthEvents)
          .where(and(inArray(healthEvents.id, linkedIds), healthEventVisibleWhere(db, auth)));
        for (const v of visible) openable.add(v.id);
      }

      return c.json({
        timeZone,
        from,
        to,
        now: now.toISOString(),
        checks: rows.map((check) => ({
          checkId: check.id,
          memberId: check.memberId,
          slots: (statuses.get(check.id) ?? []).map((r) => ({
            scheduledAt: r.scheduledAt.toISOString(),
            status: r.status,
            source: r.source,
            logId: r.logId,
            eventId: r.eventId && openable.has(r.eventId) ? r.eventId : null,
          })),
        })),
      });
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
    // Without this, two requests at once can both see 99 and both add one.
    await lockCheckQuota(db, "checks", body.memberId);
    const [{ n: existingChecks }] = await db
      .select({ n: count() })
      .from(healthChecks)
      .where(and(eq(healthChecks.memberId, body.memberId), isNull(healthChecks.deletedAt)));
    if (existingChecks >= MAX_CHECKS_PER_MEMBER) return c.json({ error: "too_many_checks" }, 409);

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
          reminderOffsetsJson: JSON.stringify(normalizeReminderOffsets(body.reminderOffsets)),
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
        patch.reminderOffsetsJson = JSON.stringify(normalizeReminderOffsets(body.reminderOffsets));
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

  /**
   * Record one slot of a check: link the health event that completes it, or skip it.
   *
   * The event is created first, through the existing `POST /events`, and linked here. That keeps
   * this endpoint small and also covers "this reading I already logged counts for the 12:00
   * check". A slot counts as done however early or late the event is. If the second call is lost,
   * nothing is: the event exists and this call is safe to retry.
   *
   * Needs `events` write on the check's person; an `events` reader can see the check but not log
   * it. `missed` is set by the system, never by a client.
   */
  app.post("/:id/log", async (c) => {
    const auth = c.get("auth")!;
    const check = await loadVisibleCheck(auth, c.req.param("id"));
    if (!check) return c.json({ error: "not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, check.memberId, "events", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = await c.req
      .json<{ scheduledAt?: unknown; status?: unknown; eventId?: unknown; notes?: unknown }>()
      .catch(() => null);
    if (!body) return c.json({ error: "invalid_body" }, 400);

    const scheduledAt =
      typeof body.scheduledAt === "string" && body.scheduledAt.includes("T")
        ? new Date(body.scheduledAt)
        : null;
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      return c.json({ error: "invalid_scheduled_at" }, 400);
    }
    const status = body.status === undefined ? "done" : body.status;
    if (status !== "done" && status !== "skipped") return c.json({ error: "invalid_status" }, 400);
    if (body.eventId !== undefined && !isUuid(body.eventId)) return c.json({ error: "invalid_body" }, 400);
    if (
      body.notes !== undefined &&
      (typeof body.notes !== "string" || body.notes.length > MAX_LOG_NOTES_LENGTH)
    ) {
      return c.json({ error: "invalid_body" }, 400);
    }

    // The caller must be able to see the event they are linking, or this would confirm that an
    // event id exists. Not found and not visible look the same.
    if (body.eventId !== undefined) {
      const [event] = await db
        .select({ id: healthEvents.id })
        .from(healthEvents)
        .where(and(eq(healthEvents.id, body.eventId), healthEventVisibleWhere(db, auth)))
        .limit(1);
      if (!event) return c.json({ error: "event_not_found" }, 404);
    }

    try {
      const { log, outcome } = await recordCheck(db, env, {
        check,
        loggedByUserId: auth.userId,
        status,
        scheduledAt,
        loggedAt: new Date(),
        notes: body.notes ?? null,
        healthEventId: body.eventId ?? null,
        source: "single",
      });
      return c.json({ log, outcome }, outcome === "inserted" ? 201 : 200);
    } catch (e) {
      if (e instanceof RecordCheckError) return c.json({ error: e.code }, RECORD_CHECK_STATUS[e.code]);
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  /**
   * A log of a check the caller may change: they must see the check and have `events` write on
   * the person, the same bar as logging a slot. Logs of a deleted check are not reachable.
   */
  async function loadWritableLog(auth: Auth, checkId: string, logId: string) {
    const check = await loadVisibleCheck(auth, checkId);
    if (!check) return { ok: false as const, status: 404 as const, error: "not_found" };
    if (!(await hasHealthSegmentAccess(db, auth, check.memberId, "events", "write"))) {
      return { ok: false as const, status: 403 as const, error: "forbidden" };
    }
    if (!isUuid(logId)) return { ok: false as const, status: 404 as const, error: "not_found" };
    const [log] = await db
      .select()
      .from(healthCheckLogs)
      .where(and(eq(healthCheckLogs.id, logId), eq(healthCheckLogs.checkId, check.id)))
      .limit(1);
    if (!log) return { ok: false as const, status: 404 as const, error: "not_found" };
    return { ok: true as const, check, log };
  }

  /**
   * Change a logged slot: done <-> skipped, swap the entry it points at, move it to another slot,
   * or edit its note. Going to `skipped` unlinks the entry but never deletes it. When the
   * reading was taken is a property of the entry, so change that with `PATCH /events/:id`.
   */
  app.patch("/:id/logs/:logId", async (c) => {
    const auth = c.get("auth")!;
    const loaded = await loadWritableLog(auth, c.req.param("id"), c.req.param("logId"));
    if (!loaded.ok) return c.json({ error: loaded.error }, loaded.status);

    const body = await c.req
      .json<{ status?: unknown; eventId?: unknown; notes?: unknown; scheduledAt?: unknown }>()
      .catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);
    if (
      body.status === undefined &&
      body.eventId === undefined &&
      body.notes === undefined &&
      body.scheduledAt === undefined
    ) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (body.status !== undefined && body.status !== "done" && body.status !== "skipped") {
      return c.json({ error: "invalid_status" }, 400);
    }
    if (body.eventId !== undefined && body.eventId !== null && !isUuid(body.eventId)) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (
      body.notes !== undefined &&
      body.notes !== null &&
      (typeof body.notes !== "string" || body.notes.length > MAX_LOG_NOTES_LENGTH)
    ) {
      return c.json({ error: "invalid_body" }, 400);
    }
    let scheduledAt: Date | undefined;
    if (body.scheduledAt !== undefined) {
      scheduledAt =
        typeof body.scheduledAt === "string" && body.scheduledAt.includes("T")
          ? new Date(body.scheduledAt)
          : undefined;
      if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
        return c.json({ error: "invalid_scheduled_at" }, 400);
      }
    }

    // Same rule as logging: the caller must be able to see the entry they link.
    if (typeof body.eventId === "string") {
      const [event] = await db
        .select({ id: healthEvents.id })
        .from(healthEvents)
        .where(and(eq(healthEvents.id, body.eventId), healthEventVisibleWhere(db, auth)))
        .limit(1);
      if (!event) return c.json({ error: "event_not_found" }, 404);
    }

    try {
      const { log, outcome } = await editCheckLog(db, env, {
        check: loaded.check,
        log: loaded.log,
        loggedByUserId: auth.userId,
        now: new Date(),
        patch: {
          status: body.status as "done" | "skipped" | undefined,
          healthEventId: body.eventId as string | null | undefined,
          notes: body.notes as string | null | undefined,
          scheduledAt,
        },
      });
      return c.json({ log, outcome });
    } catch (e) {
      if (e instanceof RecordCheckError) return c.json({ error: e.code }, RECORD_CHECK_STATUS[e.code]);
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  /**
   * Undo a slot, so it reads open again. The entry it pointed at is the person's real reading and
   * is kept; add `?deleteEvent=true` to delete it too, which needs the right to delete that entry
   * and is refused while it also completes another check.
   */
  app.delete("/:id/logs/:logId", async (c) => {
    const auth = c.get("auth")!;
    const loaded = await loadWritableLog(auth, c.req.param("id"), c.req.param("logId"));
    if (!loaded.ok) return c.json({ error: loaded.error }, loaded.status);

    const wantsEventDeleted = ["true", "1"].includes(c.req.query("deleteEvent") ?? "");
    if (wantsEventDeleted && loaded.log.healthEventId) {
      // Deleting the entry is its own permission: same bar as DELETE /events/:id, plus seeing it.
      const [event] = await db
        .select({ id: healthEvents.id, memberId: healthEvents.memberId, createdByUserId: healthEvents.createdByUserId })
        .from(healthEvents)
        .where(and(eq(healthEvents.id, loaded.log.healthEventId), healthEventVisibleWhere(db, auth)))
        .limit(1);
      const mayDelete =
        event &&
        (event.createdByUserId === auth.userId ||
          (await hasHealthSegmentAccess(db, auth, event.memberId, "events", "write")));
      if (!mayDelete) return c.json({ error: "forbidden" }, 403);
    }

    try {
      const { deletedEvent } = await deleteCheckLog(db, { log: loaded.log, deleteEvent: wantsEventDeleted });
      return c.json({ ok: true, deletedEvent });
    } catch (e) {
      if (e instanceof RecordCheckError) return c.json({ error: e.code }, RECORD_CHECK_STATUS[e.code]);
      throw e;
    }
  });

  return app;
}
