import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { healthCheckGroupMembers, healthCheckGroups, healthChecks, householdMembers } from "@domi-ops/db";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { encryptHealthField, HealthEncryptionError } from "../lib/health-crypto.js";
import {
  hasHealthSegmentAccess,
  loadHealthAclBySubjectForGrantee,
  managementGrantsForSubject,
  canAccessHealthSegment,
  normalizeHealthVisibility,
  validateHealthShareMemberIds,
} from "../lib/health-access.js";
import {
  addCheckToGroup,
  healthCheckGroupVisibleWhere,
  healthCheckVisibleWhere,
  loadGroupCheckIdsMap,
  loadHealthCheckGroupShareMap,
  removeCheckFromGroup,
  replaceHealthCheckGroupShares,
} from "../lib/health-check-access.js";
import { lockCheckQuota } from "../lib/health-check-quota.js";
import { CheckScheduleError, normalizeCheckSchedule, normalizeReminderOffsets } from "../lib/health-check-schedule.js";
import {
  enrichHealthChecks,
  serializeHealthCheckGroup,
  type SerializedHealthCheck,
} from "../lib/health-check-serialize.js";
import { validateCheckDateRange } from "../lib/health-check-template.js";
import { isForeignKeyViolationError } from "../lib/db-errors.js";
import { parseMedSchedule } from "../lib/health-serialize.js";
import { isUuid, isUuidList } from "../lib/uuid.js";

type Auth = NonNullable<AppVariables["auth"]>;
type GroupRow = typeof healthCheckGroups.$inferSelect;

const MAX_NAME_LENGTH = 200;
function encryptionErrorResponse(c: { json: (body: unknown, status?: number) => Response }, e: unknown) {
  if (e instanceof HealthEncryptionError) {
    return c.json({ error: "encryption_key_required", message: e.message }, 503);
  }
  return null;
}


/**
 * Check groups (WHO-382): one consolidated reminder for several checks of the same member
 * ("Morning: BP, weight, pain"). Same many-to-many membership as medication groups, same
 * `events`-segment permissions as checks. A group only holds checks of its own member: validated
 * here, and enforced by composite foreign keys in the database.
 */
/** Same idea as the per-person check limit: far above real use, there to bound the worker's load. */
export const MAX_CHECK_GROUPS_PER_MEMBER = 50;

export function healthCheckGroupRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  async function loadVisibleGroup(auth: Auth, id: string) {
    if (!isUuid(id)) return undefined;
    const [row] = await db
      .select()
      .from(healthCheckGroups)
      .where(and(eq(healthCheckGroups.id, id), healthCheckGroupVisibleWhere(db, auth)))
      .limit(1);
    return row;
  }

  async function canWriteGroup(auth: Auth, row: GroupRow) {
    return (
      row.createdByUserId === auth.userId ||
      (await hasHealthSegmentAccess(db, auth, row.memberId, "events", "write"))
    );
  }

  /** Member checks per group, limited to the ones the caller may see. */
  async function loadGroupChecks(auth: Auth, groupIds: string[]) {
    const idsByGroup = await loadGroupCheckIdsMap(db, groupIds);
    const allIds = [...new Set([...idsByGroup.values()].flat())];
    const rows =
      allIds.length > 0
        ? await db
            .select()
            .from(healthChecks)
            .where(
              and(
                inArray(healthChecks.id, allIds),
                isNull(healthChecks.deletedAt),
                healthCheckVisibleWhere(db, auth),
              ),
            )
        : [];
    const serialized = await enrichHealthChecks(db, env, auth, rows);
    const byId = new Map(serialized.map((s) => [s.id, s]));
    const out = new Map<string, SerializedHealthCheck[]>();
    for (const [groupId, ids] of idsByGroup) {
      out.set(
        groupId,
        ids.map((id) => byId.get(id)).filter((s): s is SerializedHealthCheck => s !== undefined),
      );
    }
    return out;
  }

  async function respondWithGroup(auth: Auth, row: GroupRow) {
    const checks = (await loadGroupChecks(auth, [row.id])).get(row.id) ?? [];
    const shareMap = await loadHealthCheckGroupShareMap(db, row.visibility === "private" ? [row.id] : []);
    const isOwnedByMe = row.createdByUserId === auth.userId;
    const aclBySubject = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);
    const grants = managementGrantsForSubject(aclBySubject, row.memberId, auth.memberId, auth.role);
    const canEdit = isOwnedByMe || canAccessHealthSegment(grants, "events", "write");
    return serializeHealthCheckGroup(row, env, checks, {
      sharedMemberIds: canEdit ? shareMap.get(row.id) ?? [] : undefined,
      isOwnedByMe,
      canEdit,
    });
  }

  app.get("/", async (c) => {
    const auth = c.get("auth")!;
    const memberId = c.req.query("memberId");
    if (memberId !== undefined && !isUuid(memberId)) return c.json({ error: "invalid_member" }, 400);
    const rows = await db
      .select()
      .from(healthCheckGroups)
      .where(
        and(
          healthCheckGroupVisibleWhere(db, auth),
          memberId ? eq(healthCheckGroups.memberId, memberId) : undefined,
        ),
      )
      .orderBy(desc(healthCheckGroups.createdAt));
    try {
      const checksByGroup = await loadGroupChecks(auth, rows.map((r) => r.id));
      const shareMap = await loadHealthCheckGroupShareMap(
        db,
        rows.filter((r) => r.visibility === "private").map((r) => r.id),
      );
      const aclBySubject = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);
      const groups = rows.map((row) => {
        const isOwnedByMe = row.createdByUserId === auth.userId;
        const grants = managementGrantsForSubject(aclBySubject, row.memberId, auth.memberId, auth.role);
        const canEdit = isOwnedByMe || canAccessHealthSegment(grants, "events", "write");
        return serializeHealthCheckGroup(row, env, checksByGroup.get(row.id) ?? [], {
          sharedMemberIds: canEdit ? shareMap.get(row.id) ?? [] : undefined,
          isOwnedByMe,
          canEdit,
        });
      });
      return c.json({ groups });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.get("/:id", async (c) => {
    const auth = c.get("auth")!;
    const row = await loadVisibleGroup(auth, c.req.param("id"));
    if (!row) return c.json({ error: "not_found" }, 404);
    try {
      return c.json({ group: await respondWithGroup(auth, row) });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.post("/", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req
      .json<{
        memberId?: string;
        name?: string;
        scheduleKind?: string;
        schedule?: Parameters<typeof normalizeCheckSchedule>[0]["schedule"];
        reminderOffsets?: number[];
        startDate?: string | null;
        endDate?: string | null;
        enabled?: boolean;
        visibility?: string;
        sharedMemberIds?: string[];
        checkIds?: string[];
      }>()
      .catch(() => null);

    if (
      !body ||
      !isUuid(body.memberId) ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > MAX_NAME_LENGTH ||
      (body.enabled !== undefined && typeof body.enabled !== "boolean") ||
      (body.checkIds !== undefined && !isUuidList(body.checkIds)) ||
      (body.sharedMemberIds !== undefined && !isUuidList(body.sharedMemberIds))
    ) {
      return c.json({ error: "invalid_body" }, 400);
    }

    const [member] = await db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(and(eq(householdMembers.id, body.memberId), eq(householdMembers.householdId, auth.householdId)))
      .limit(1);
    if (!member) return c.json({ error: "member_not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, body.memberId, "events", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    await lockCheckQuota(db, "check-groups", body.memberId);
    const [{ n: existingGroups }] = await db
      .select({ n: count() })
      .from(healthCheckGroups)
      .where(eq(healthCheckGroups.memberId, body.memberId));
    if (existingGroups >= MAX_CHECK_GROUPS_PER_MEMBER) return c.json({ error: "too_many_groups" }, 409);

    let scheduleMeta;
    try {
      scheduleMeta = normalizeCheckSchedule(body);
    } catch (e) {
      if (e instanceof CheckScheduleError) return c.json({ error: e.code }, 400);
      throw e;
    }
    const dateError = validateCheckDateRange(body.startDate, body.endDate);
    if (dateError) return c.json({ error: dateError }, 400);

    // Validate every requested member check before writing anything.
    const wantedIds = [...new Set(body.checkIds ?? [])];
    const eligible =
      wantedIds.length > 0
        ? await db
            .select({ id: healthChecks.id, memberId: healthChecks.memberId })
            .from(healthChecks)
            .where(
              and(
                inArray(healthChecks.id, wantedIds),
                isNull(healthChecks.deletedAt),
                healthCheckVisibleWhere(db, auth),
              ),
            )
        : [];
    if (eligible.length !== wantedIds.length) return c.json({ error: "check_not_found" }, 400);
    if (eligible.some((ch) => ch.memberId !== body.memberId)) return c.json({ error: "member_mismatch" }, 400);

    try {
      const visibility = normalizeHealthVisibility(body.visibility);
      const [row] = await db
        .insert(healthCheckGroups)
        .values({
          householdId: auth.householdId,
          memberId: body.memberId,
          name: encryptHealthField(body.name.trim(), env) ?? "",
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

      if (visibility === "private" && Array.isArray(body.sharedMemberIds)) {
        const shared = await validateHealthShareMemberIds(db, auth.householdId, body.sharedMemberIds, auth.memberId);
        await replaceHealthCheckGroupShares(db, row.id, shared);
      }
      for (const check of eligible) await addCheckToGroup(db, row.id, check.id, row.memberId);

      return c.json({ group: await respondWithGroup(auth, row) }, 201);
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      if (isForeignKeyViolationError(e)) return c.json({ error: "member_mismatch" }, 400);
      throw e;
    }
  });

  app.patch("/:id", async (c) => {
    const auth = c.get("auth")!;
    const existing = await loadVisibleGroup(auth, c.req.param("id"));
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (!(await canWriteGroup(auth, existing))) return c.json({ error: "forbidden" }, 403);

    const body = await c.req
      .json<{
        name?: string;
        scheduleKind?: string;
        schedule?: Parameters<typeof normalizeCheckSchedule>[0]["schedule"];
        reminderOffsets?: number[];
        startDate?: string | null;
        endDate?: string | null;
        enabled?: boolean;
        visibility?: string;
        sharedMemberIds?: string[];
        memberId?: string;
      }>()
      .catch(() => null);
    if (!body) return c.json({ error: "invalid_body" }, 400);

    if (body.memberId !== undefined && body.memberId !== existing.memberId) {
      return c.json({ error: "immutable_field", field: "memberId" }, 400);
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

    const patch: Partial<typeof healthCheckGroups.$inferInsert> = { updatedAt: new Date() };
    if (body.scheduleKind !== undefined || body.schedule !== undefined) {
      try {
        const scheduleMeta = normalizeCheckSchedule({
          scheduleKind: body.scheduleKind ?? existing.scheduleKind,
          schedule: body.schedule ?? parseMedSchedule(existing.scheduleJson),
        });
        patch.scheduleKind = scheduleMeta.scheduleKind;
        patch.scheduleJson = scheduleMeta.scheduleJson;
      } catch (e) {
        if (e instanceof CheckScheduleError) return c.json({ error: e.code }, 400);
        throw e;
      }
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

      const [row] = await db
        .update(healthCheckGroups)
        .set(patch)
        .where(eq(healthCheckGroups.id, existing.id))
        .returning();

      if (row.visibility === "household") {
        await replaceHealthCheckGroupShares(db, row.id, []);
      } else if (body.sharedMemberIds !== undefined) {
        const shared = await validateHealthShareMemberIds(db, auth.householdId, body.sharedMemberIds, auth.memberId);
        await replaceHealthCheckGroupShares(db, row.id, shared);
      }

      return c.json({ group: await respondWithGroup(auth, row) });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth")!;
    const existing = await loadVisibleGroup(auth, c.req.param("id"));
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (!(await canWriteGroup(auth, existing))) return c.json({ error: "forbidden" }, 403);
    // Membership and share rows cascade; the member checks themselves are untouched.
    await db.delete(healthCheckGroups).where(eq(healthCheckGroups.id, existing.id));
    return c.json({ ok: true });
  });

  app.post("/:id/members", async (c) => {
    const auth = c.get("auth")!;
    const group = await loadVisibleGroup(auth, c.req.param("id"));
    if (!group) return c.json({ error: "not_found" }, 404);
    if (!(await canWriteGroup(auth, group))) return c.json({ error: "forbidden" }, 403);

    const body = await c.req.json<{ checkId?: string }>().catch(() => null);
    if (!body || !isUuid(body.checkId)) return c.json({ error: "invalid_body" }, 400);

    const [check] = await db
      .select()
      .from(healthChecks)
      .where(
        and(eq(healthChecks.id, body.checkId), isNull(healthChecks.deletedAt), healthCheckVisibleWhere(db, auth)),
      )
      .limit(1);
    if (!check) return c.json({ error: "not_found" }, 404);
    if (check.memberId !== group.memberId) return c.json({ error: "member_mismatch" }, 400);

    try {
      await addCheckToGroup(db, group.id, check.id, group.memberId);
      return c.json({ group: await respondWithGroup(auth, group) });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      if (isForeignKeyViolationError(e)) return c.json({ error: "member_mismatch" }, 400);
      throw e;
    }
  });

  app.delete("/:id/members/:checkId", async (c) => {
    const auth = c.get("auth")!;
    const group = await loadVisibleGroup(auth, c.req.param("id"));
    if (!group) return c.json({ error: "not_found" }, 404);
    if (!(await canWriteGroup(auth, group))) return c.json({ error: "forbidden" }, 403);

    const checkId = c.req.param("checkId");
    if (!isUuid(checkId)) return c.json({ error: "not_found" }, 404);
    const [membership] = await db
      .select({ checkId: healthCheckGroupMembers.checkId })
      .from(healthCheckGroupMembers)
      .where(and(eq(healthCheckGroupMembers.groupId, group.id), eq(healthCheckGroupMembers.checkId, checkId)))
      .limit(1);
    if (!membership) return c.json({ error: "not_found" }, 404);

    await removeCheckFromGroup(db, group.id, checkId);
    try {
      return c.json({ group: await respondWithGroup(auth, group) });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  return app;
}
