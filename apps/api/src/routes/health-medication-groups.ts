import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { isModuleEnabled } from "@domi-ops/config";
import {
  healthMedPushActionSecret,
  verifyHealthMedGroupPushActionToken,
  type HealthMedPushActionStatus,
} from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import {
  healthMedicationGroups,
  healthMedicationLogs,
  healthMedications,
  householdMembers,
} from "@domi-ops/db";
import { and, eq, isNull } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { isHouseholdModuleEnabled, requireHouseholdModule } from "../lib/household-modules.js";
import { decryptHealthFieldOrPassthrough, HealthEncryptionError } from "../lib/health-crypto.js";
import {
  hasHealthSegmentAccess,
  healthMedicationGroupVisibleWhere,
  loadHealthMedicationGroupShareMap,
  normalizeHealthVisibility,
  replaceHealthMedicationGroupShares,
  validateHealthShareMemberIds,
} from "../lib/health-access.js";
import {
  encryptHealthTextFields,
  normalizeMedSchedule,
  parseMedSchedule,
  serializeHealthLog,
  serializeHealthMedication,
} from "../lib/health-serialize.js";
import { logMedicationDose } from "../lib/health-med-logging.js";

type HealthMedicationGroupRow = typeof healthMedicationGroups.$inferSelect;
type SerializedHealthMedication = ReturnType<typeof serializeHealthMedication>;
type SerializedHealthLog = ReturnType<typeof serializeHealthLog>;

type LogAllResult =
  | { medicationId: string; alreadyLogged: boolean; log: SerializedHealthLog }
  | { medicationId: string; error: string };

function encryptionErrorResponse(c: { json: (body: unknown, status?: number) => Response }, e: unknown) {
  if (e instanceof HealthEncryptionError) {
    return c.json({ error: "encryption_key_required", message: e.message }, 503);
  }
  return null;
}

function parseReminderOffsets(raw: string | null | undefined): number[] {
  if (!raw) return [0];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.filter((n): n is number => typeof n === "number");
  } catch {
    // ignore
  }
  return [0];
}

function serializeGroup(
  row: HealthMedicationGroupRow,
  env: Env,
  members: SerializedHealthMedication[],
  extras?: { sharedMemberIds?: string[]; isOwnedByMe?: boolean; canEdit?: boolean },
) {
  return {
    id: row.id,
    memberId: row.memberId,
    name: decryptHealthFieldOrPassthrough(row.name, env) ?? "",
    scheduleKind: row.scheduleKind,
    schedule: parseMedSchedule(row.scheduleJson),
    reminderOffsets: parseReminderOffsets(row.reminderOffsetsJson),
    startDate: row.startDate,
    endDate: row.endDate,
    enabled: row.enabled,
    visibility: row.visibility,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    medications: members,
    sharedMemberIds: extras?.sharedMemberIds,
    isOwnedByMe: extras?.isOwnedByMe,
    canEdit: extras?.canEdit,
  };
}

/** Loop the shared per-medication log logic over every member medication of a group. */
async function logAllGroupMembers(
  db: Database,
  env: Env,
  input: {
    group: HealthMedicationGroupRow;
    loggedByUserId: string;
    status: "taken" | "skipped" | "missed";
    scheduledAt: Date;
    loggedAt: Date;
    alsoCreateEvent?: boolean;
  },
): Promise<LogAllResult[]> {
  const memberMeds = await db
    .select()
    .from(healthMedications)
    .where(
      and(
        eq(healthMedications.groupId, input.group.id),
        eq(healthMedications.householdId, input.group.householdId),
      ),
    );

  const results: LogAllResult[] = [];
  for (const med of memberMeds) {
    try {
      const [existing] = await db
        .select()
        .from(healthMedicationLogs)
        .where(
          and(
            eq(healthMedicationLogs.medicationId, med.id),
            eq(healthMedicationLogs.scheduledAt, input.scheduledAt),
          ),
        )
        .limit(1);
      if (existing) {
        results.push({ medicationId: med.id, alreadyLogged: true, log: serializeHealthLog(existing, env) });
        continue;
      }
      const { log } = await logMedicationDose(db, env, {
        med,
        householdId: input.group.householdId,
        loggedByUserId: input.loggedByUserId,
        status: input.status,
        scheduledAt: input.scheduledAt,
        loggedAt: input.loggedAt,
        alsoCreateEvent: input.alsoCreateEvent ?? false,
      });
      results.push({ medicationId: med.id, alreadyLogged: false, log });
    } catch (e) {
      if (e instanceof HealthEncryptionError) throw e;
      results.push({ medicationId: med.id, error: e instanceof Error ? e.message : "log_failed" });
    }
  }
  return results;
}

export function healthMedicationGroupRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  /**
   * Token-authenticated "take all" for a group's Web Push action button — parallel to
   * POST /medications/push-action. Registered before requireAuth (token carries its own auth).
   */
  app.post("/push-action", async (c) => {
    if (!isModuleEnabled(env, "health")) {
      return c.json({ error: "module_disabled" }, 403);
    }
    const secret = healthMedPushActionSecret(env);
    if (!secret) {
      return c.json({ error: "token_unavailable" }, 503);
    }
    const body = await c.req.json<{ token?: string; action?: string }>().catch(() => ({}) as {
      token?: string;
      action?: string;
    });
    const token = typeof body.token === "string" ? body.token : "";
    const action: HealthMedPushActionStatus | null =
      body.action === "skipped" || body.action === "skip"
        ? "skipped"
        : body.action === "taken"
          ? "taken"
          : null;
    if (!token || !action) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const claims = verifyHealthMedGroupPushActionToken(token, secret);
    if (!claims) {
      return c.json({ error: "invalid_token" }, 401);
    }
    if (!claims.actions.includes(action)) {
      return c.json({ error: "action_not_allowed" }, 403);
    }
    if (!(await isHouseholdModuleEnabled(db, env, claims.householdId, "health"))) {
      return c.json({ error: "module_disabled" }, 403);
    }

    const [member] = await db
      .select({
        memberId: householdMembers.id,
        role: householdMembers.role,
        userId: householdMembers.userId,
        householdId: householdMembers.householdId,
      })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.userId, claims.userId),
          eq(householdMembers.householdId, claims.householdId),
        ),
      )
      .limit(1);
    if (!member?.userId) {
      return c.json({ error: "forbidden" }, 403);
    }
    const auth = {
      userId: member.userId,
      householdId: member.householdId,
      memberId: member.memberId,
      role: member.role,
    };

    const [group] = await db
      .select()
      .from(healthMedicationGroups)
      .where(
        and(
          eq(healthMedicationGroups.id, claims.medicationGroupId),
          eq(healthMedicationGroups.householdId, claims.householdId),
        ),
      )
      .limit(1);
    if (!group) return c.json({ error: "not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, group.memberId, "doses", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const scheduledAt = new Date(claims.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      return c.json({ error: "invalid_token" }, 401);
    }

    try {
      const results = await logAllGroupMembers(db, env, {
        group,
        loggedByUserId: auth.userId,
        status: action,
        scheduledAt,
        loggedAt: new Date(),
      });
      return c.json({ ok: true, results }, 201);
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  app.get("/", async (c) => {
    const auth = c.get("auth")!;
    const groups = await db
      .select()
      .from(healthMedicationGroups)
      .where(healthMedicationGroupVisibleWhere(db, auth));
    const shareMap = await loadHealthMedicationGroupShareMap(
      db,
      groups.filter((g) => g.visibility === "private").map((g) => g.id),
    );
    const allMemberMeds =
      groups.length > 0
        ? await db.select().from(healthMedications).where(eq(healthMedications.householdId, auth.householdId))
        : [];
    const membersByGroup = new Map<string, (typeof healthMedications.$inferSelect)[]>();
    for (const med of allMemberMeds) {
      if (!med.groupId) continue;
      const list = membersByGroup.get(med.groupId) ?? [];
      list.push(med);
      membersByGroup.set(med.groupId, list);
    }
    const result = groups.map((g) => {
      const isOwnedByMe = g.createdByUserId === auth.userId;
      const members = (membersByGroup.get(g.id) ?? []).map((m) => serializeHealthMedication(m, env));
      return serializeGroup(g, env, members, {
        sharedMemberIds: isOwnedByMe ? shareMap.get(g.id) : undefined,
        isOwnedByMe,
        canEdit: isOwnedByMe || g.visibility === "household",
      });
    });
    return c.json({ groups: result });
  });

  app.post("/", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      memberId: string;
      name: string;
      scheduleKind?: string;
      schedule?: { times?: string[]; daysOfWeek?: number[] };
      reminderOffsets?: number[];
      startDate?: string;
      endDate?: string;
      enabled?: boolean;
      visibility?: string;
      sharedMemberIds?: string[];
      medicationIds?: string[];
    }>();

    if (!body.memberId || !body.name?.trim()) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (body.scheduleKind === "prn") {
      return c.json({ error: "group_schedule_must_be_scheduled_or_interval" }, 400);
    }
    if (!(await hasHealthSegmentAccess(db, auth, body.memberId, "medications", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }

    try {
      let scheduleMeta: { scheduleKind: "scheduled" | "interval"; scheduleJson: string };
      try {
        const normalized = normalizeMedSchedule(body);
        if (normalized.scheduleKind === "prn") {
          return c.json({ error: "group_schedule_must_be_scheduled_or_interval" }, 400);
        }
        scheduleMeta = normalized;
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : "invalid_schedule" }, 400);
      }

      const enc = encryptHealthTextFields(env, { name: body.name.trim() });
      const visibility = normalizeHealthVisibility(body.visibility);
      const offsets = body.reminderOffsets?.filter((n) => typeof n === "number" && n >= 0) ?? [0];

      const [row] = await db
        .insert(healthMedicationGroups)
        .values({
          householdId: auth.householdId,
          memberId: body.memberId,
          name: enc.name!,
          scheduleKind: scheduleMeta.scheduleKind,
          scheduleJson: scheduleMeta.scheduleJson,
          reminderOffsetsJson: JSON.stringify(offsets),
          startDate: body.startDate ?? null,
          endDate: body.endDate ?? null,
          enabled: body.enabled ?? true,
          visibility,
          createdByUserId: auth.userId,
        })
        .returning();

      let sharedMemberIds: string[] = [];
      if (visibility === "private" && Array.isArray(body.sharedMemberIds)) {
        sharedMemberIds = await validateHealthShareMemberIds(
          db,
          auth.householdId,
          body.sharedMemberIds,
          auth.memberId,
        );
        await replaceHealthMedicationGroupShares(db, row.id, sharedMemberIds);
      }

      const members: SerializedHealthMedication[] = [];
      if (Array.isArray(body.medicationIds) && body.medicationIds.length > 0) {
        const candidates = await db
          .select()
          .from(healthMedications)
          .where(
            and(
              eq(healthMedications.householdId, auth.householdId),
              eq(healthMedications.memberId, body.memberId),
              isNull(healthMedications.groupId),
            ),
          );
        const allowed = new Set(body.medicationIds);
        for (const med of candidates.filter((m) => allowed.has(m.id))) {
          const [updated] = await db
            .update(healthMedications)
            .set({ groupId: row.id, updatedAt: new Date() })
            .where(eq(healthMedications.id, med.id))
            .returning();
          members.push(serializeHealthMedication(updated, env));
        }
      }

      return c.json(
        { group: serializeGroup(row, env, members, { sharedMemberIds, isOwnedByMe: true, canEdit: true }) },
        201,
      );
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.patch("/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(healthMedicationGroups)
      .where(and(eq(healthMedicationGroups.id, id), eq(healthMedicationGroups.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const canWrite =
      existing.createdByUserId === auth.userId ||
      existing.visibility === "household" ||
      (await hasHealthSegmentAccess(db, auth, existing.memberId, "medications", "write"));
    if (existing.visibility === "private" && !canWrite) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = await c.req.json<{
      name?: string;
      scheduleKind?: string;
      schedule?: { times?: string[]; daysOfWeek?: number[] };
      reminderOffsets?: number[];
      startDate?: string | null;
      endDate?: string | null;
      enabled?: boolean;
      visibility?: string;
      sharedMemberIds?: string[];
    }>();

    if (body.scheduleKind === "prn") {
      return c.json({ error: "group_schedule_must_be_scheduled_or_interval" }, 400);
    }

    try {
      const patch: Partial<typeof healthMedicationGroups.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) {
        const enc = encryptHealthTextFields(env, { name: body.name });
        patch.name = enc.name!;
      }
      if (body.scheduleKind !== undefined || body.schedule !== undefined) {
        try {
          const normalized = normalizeMedSchedule({
            scheduleKind: body.scheduleKind ?? existing.scheduleKind,
            schedule: body.schedule ?? parseMedSchedule(existing.scheduleJson),
          });
          if (normalized.scheduleKind === "prn") {
            return c.json({ error: "group_schedule_must_be_scheduled_or_interval" }, 400);
          }
          patch.scheduleKind = normalized.scheduleKind;
          patch.scheduleJson = normalized.scheduleJson;
        } catch (e) {
          return c.json({ error: e instanceof Error ? e.message : "invalid_schedule" }, 400);
        }
      }
      if (body.reminderOffsets !== undefined) {
        patch.reminderOffsetsJson = JSON.stringify(
          body.reminderOffsets.filter((n) => typeof n === "number" && n >= 0),
        );
      }
      if (body.startDate !== undefined) patch.startDate = body.startDate;
      if (body.endDate !== undefined) patch.endDate = body.endDate;
      if (body.enabled !== undefined) patch.enabled = body.enabled;
      if (body.visibility !== undefined) patch.visibility = normalizeHealthVisibility(body.visibility);

      const [row] = await db
        .update(healthMedicationGroups)
        .set(patch)
        .where(eq(healthMedicationGroups.id, id))
        .returning();

      if (body.sharedMemberIds !== undefined && row.visibility === "private") {
        const sharedMemberIds = await validateHealthShareMemberIds(
          db,
          auth.householdId,
          body.sharedMemberIds,
          auth.memberId,
        );
        await replaceHealthMedicationGroupShares(db, row.id, sharedMemberIds);
      }
      if (row.visibility === "household") {
        await replaceHealthMedicationGroupShares(db, row.id, []);
      }

      const members = await db.select().from(healthMedications).where(eq(healthMedications.groupId, row.id));
      const shareMap = await loadHealthMedicationGroupShareMap(
        db,
        row.visibility === "private" ? [row.id] : [],
      );
      return c.json({
        group: serializeGroup(row, env, members.map((m) => serializeHealthMedication(m, env)), {
          sharedMemberIds: shareMap.get(row.id),
          isOwnedByMe: row.createdByUserId === auth.userId,
          canEdit: true,
        }),
      });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(healthMedicationGroups)
      .where(and(eq(healthMedicationGroups.id, id), eq(healthMedicationGroups.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    const canDelete =
      existing.createdByUserId === auth.userId ||
      (await hasHealthSegmentAccess(db, auth, existing.memberId, "medications", "write"));
    if (!canDelete) return c.json({ error: "forbidden" }, 403);
    // ON DELETE SET NULL on health_medications.group_id ungroups member meds automatically.
    await db.delete(healthMedicationGroups).where(eq(healthMedicationGroups.id, id));
    return c.json({ ok: true });
  });

  app.post("/:id/members", async (c) => {
    const auth = c.get("auth")!;
    const groupId = c.req.param("id");
    const [group] = await db
      .select()
      .from(healthMedicationGroups)
      .where(and(eq(healthMedicationGroups.id, groupId), eq(healthMedicationGroups.householdId, auth.householdId)))
      .limit(1);
    if (!group) return c.json({ error: "not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, group.memberId, "medications", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = await c.req.json<{ medicationId?: string }>();
    if (!body.medicationId) return c.json({ error: "invalid_body" }, 400);
    const [med] = await db
      .select()
      .from(healthMedications)
      .where(
        and(
          eq(healthMedications.id, body.medicationId),
          eq(healthMedications.householdId, auth.householdId),
        ),
      )
      .limit(1);
    if (!med) return c.json({ error: "not_found" }, 404);
    if (med.memberId !== group.memberId) {
      return c.json({ error: "member_mismatch" }, 400);
    }
    const [updated] = await db
      .update(healthMedications)
      .set({ groupId: group.id, updatedAt: new Date() })
      .where(eq(healthMedications.id, med.id))
      .returning();
    return c.json({ medication: serializeHealthMedication(updated, env) });
  });

  app.delete("/:id/members/:medicationId", async (c) => {
    const auth = c.get("auth")!;
    const groupId = c.req.param("id");
    const medicationId = c.req.param("medicationId");
    const [med] = await db
      .select()
      .from(healthMedications)
      .where(
        and(
          eq(healthMedications.id, medicationId),
          eq(healthMedications.householdId, auth.householdId),
          eq(healthMedications.groupId, groupId),
        ),
      )
      .limit(1);
    if (!med) return c.json({ error: "not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, med.memberId, "medications", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [updated] = await db
      .update(healthMedications)
      .set({ groupId: null, updatedAt: new Date() })
      .where(eq(healthMedications.id, med.id))
      .returning();
    return c.json({ medication: serializeHealthMedication(updated, env) });
  });

  app.post("/:id/log-all", async (c) => {
    const auth = c.get("auth")!;
    const groupId = c.req.param("id");
    const [group] = await db
      .select()
      .from(healthMedicationGroups)
      .where(and(eq(healthMedicationGroups.id, groupId), eq(healthMedicationGroups.householdId, auth.householdId)))
      .limit(1);
    if (!group) return c.json({ error: "not_found" }, 404);
    const visible = await db
      .select({ id: healthMedicationGroups.id })
      .from(healthMedicationGroups)
      .where(and(eq(healthMedicationGroups.id, groupId), healthMedicationGroupVisibleWhere(db, auth)))
      .limit(1);
    if (visible.length === 0) return c.json({ error: "not_found" }, 404);
    if (!(await hasHealthSegmentAccess(db, auth, group.memberId, "doses", "write"))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = await c.req.json<{
      scheduledAt?: string;
      status?: string;
      alsoCreateEvent?: boolean;
    }>();
    if (!body.scheduledAt) return c.json({ error: "scheduled_at_required" }, 400);
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) return c.json({ error: "invalid_scheduled_at" }, 400);
    const status = body.status === "skipped" || body.status === "missed" ? body.status : "taken";

    try {
      const results = await logAllGroupMembers(db, env, {
        group,
        loggedByUserId: auth.userId,
        status,
        scheduledAt,
        loggedAt: new Date(),
        alsoCreateEvent: body.alsoCreateEvent ?? false,
      });
      return c.json({ results }, 201);
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  return app;
}
