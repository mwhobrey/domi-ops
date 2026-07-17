import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  healthEvents,
  healthMedicationLogs,
  healthMedications,
  households,
} from "@domi-ops/db";
import { and, desc, eq } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import { HealthEncryptionError } from "../lib/health-crypto.js";
import {
  canManageMemberHealth,
  healthEventVisibleWhere,
  healthMedicationVisibleWhere,
  loadHealthEventShareMap,
  loadHealthMedicationShareMap,
  normalizeHealthVisibility,
  replaceHealthEventShares,
  replaceHealthMedicationShares,
  validateHealthShareMemberIds,
} from "../lib/health-access.js";
import { todayIsoDateInTz, zonedLocalToUtc, formatTimeLabelInTz } from "@domi-ops/calendar-sync";
import {
  encryptHealthTextFields,
  enrichHealthEvents,
  enrichHealthMedications,
  normalizeMedSchedule,
  parseMedSchedule,
  resolveEventInstant,
  serializeHealthEvent,
  serializeHealthLog,
  serializeHealthMedication,
} from "../lib/health-serialize.js";
import { buildHealthReports } from "../lib/health-reports.js";
import { decryptHealthFieldOrPassthrough, encryptHealthField } from "../lib/health-crypto.js";

function encryptionErrorResponse(c: { json: (body: unknown, status?: number) => Response }, e: unknown) {
  if (e instanceof HealthEncryptionError) {
    return c.json({ error: "encryption_key_required", message: e.message }, 503);
  }
  return null;
}

function normalizeDurationKind(value: unknown): "single_day" | "ongoing" {
  return value === "ongoing" ? "ongoing" : "single_day";
}

async function householdTimezone(db: Database, householdId: string): Promise<string> {
  const [household] = await db
    .select({ timezone: households.timezone })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);
  return household?.timezone ?? "UTC";
}

export function householdHealthRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("/*", requireAuth(env));
  app.use("/*", requireHouseholdModule(db, env, "health"));

  app.get("/glance", async (c) => {
    const auth = c.get("auth")!;
    const [household] = await db
      .select({ timezone: households.timezone })
      .from(households)
      .where(eq(households.id, auth.householdId))
      .limit(1);
    const tz = household?.timezone ?? "UTC";
    const today = todayIsoDateInTz(tz);
    const dayStart = zonedLocalToUtc(today, "00:00", tz);
    const dayEnd = zonedLocalToUtc(today, "23:59", tz);

    const eventRows = await db
      .select()
      .from(healthEvents)
      .where(healthEventVisibleWhere(db, auth))
      .orderBy(desc(healthEvents.startedAt))
      .limit(20);

    const medRows = await db
      .select()
      .from(healthMedications)
      .where(
        and(healthMedicationVisibleWhere(db, auth), eq(healthMedications.enabled, true)),
      );

    const scheduledMeds = medRows.filter((m) => m.scheduleKind === "scheduled");
    const prnMeds = medRows.filter((m) => m.scheduleKind === "prn");

    const pendingDoses: {
      medicationId: string;
      name: string;
      scheduledAt: string;
      scheduledTime: string;
      scheduledTimeLabel: string;
      memberId: string;
    }[] = [];

    for (const med of scheduledMeds) {
      const schedule = parseMedSchedule(med.scheduleJson);
      const times = schedule.times ?? [];
      const name = decryptHealthFieldOrPassthrough(med.name, env) ?? "Medication";
      if (med.startDate && today < med.startDate) continue;
      if (med.endDate && today > med.endDate) continue;
      if (schedule.daysOfWeek?.length) {
        const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
        if (!schedule.daysOfWeek.includes(dow)) continue;
      }
      for (const time of times) {
        const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
        const scheduledAt = zonedLocalToUtc(today, hhmm, tz);
        if (scheduledAt < dayStart || scheduledAt > dayEnd) continue;
        const [logged] = await db
          .select({ id: healthMedicationLogs.id })
          .from(healthMedicationLogs)
          .where(
            and(
              eq(healthMedicationLogs.medicationId, med.id),
              eq(healthMedicationLogs.scheduledAt, scheduledAt),
            ),
          )
          .limit(1);
        if (!logged) {
          pendingDoses.push({
            medicationId: med.id,
            name,
            scheduledAt: scheduledAt.toISOString(),
            scheduledTime: hhmm,
            scheduledTimeLabel: formatTimeLabelInTz(scheduledAt, tz),
            memberId: med.memberId,
          });
        }
      }
    }

    const events = await enrichHealthEvents(db, env, auth, eventRows.slice(0, 5));
    const prnList = await enrichHealthMedications(db, env, auth, prnMeds);

    return c.json({
      enabled: true,
      today,
      timezone: tz,
      activeEvents: events,
      pendingDoses,
      prnMedications: prnList,
    });
  });

  app.get("/reports", async (c) => {
    const auth = c.get("auth")!;
    const to = c.req.query("to")?.trim() || todayIsoDateInTz(await householdTimezone(db, auth.householdId));
    const fromDefault = new Date(`${to}T12:00:00.000Z`);
    fromDefault.setUTCDate(fromDefault.getUTCDate() - 30);
    const from = c.req.query("from")?.trim() || fromDefault.toISOString().slice(0, 10);
    const memberId = c.req.query("memberId")?.trim() || null;
    const eventType = c.req.query("eventType")?.trim() || null;
    const groupBy = c.req.query("groupBy")?.trim() || null;
    const report = await buildHealthReports(db, env, auth, from, to, {
      memberId,
      eventType,
      groupBy,
    });
    return c.json(report);
  });

  app.get("/events", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(healthEvents)
      .where(healthEventVisibleWhere(db, auth))
      .orderBy(desc(healthEvents.startedAt));
    const events = await enrichHealthEvents(db, env, auth, rows);
    return c.json({ events });
  });

  app.get("/events/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [row] = await db
      .select()
      .from(healthEvents)
      .where(
        and(eq(healthEvents.id, id), eq(healthEvents.householdId, auth.householdId)),
      )
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    const visible = await db
      .select({ id: healthEvents.id })
      .from(healthEvents)
      .where(and(eq(healthEvents.id, id), healthEventVisibleWhere(db, auth)))
      .limit(1);
    if (visible.length === 0) return c.json({ error: "not_found" }, 404);
    const [event] = await enrichHealthEvents(db, env, auth, [row]);
    return c.json({ event });
  });

  app.post("/events", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      memberId: string;
      type?: string;
      title: string;
      notes?: string;
      startedAt?: string;
      endedAt?: string;
      startDate?: string | null;
      startTime?: string | null;
      endDate?: string | null;
      endTime?: string | null;
      durationKind?: string;
      visibility?: string;
      sharedMemberIds?: string[];
      medicationId?: string;
    }>();

    if (!body.memberId || !body.title?.trim()) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (!canManageMemberHealth(auth.role, body.memberId, auth.memberId)) {
      return c.json({ error: "forbidden" }, 403);
    }

    try {
      const enc = encryptHealthTextFields(env, {
        title: body.title.trim(),
        notes: body.notes ?? null,
      });
      const visibility = normalizeHealthVisibility(body.visibility);
      const durationKind = normalizeDurationKind(body.durationKind);
      const tz = await householdTimezone(db, auth.householdId);
      const startedAt = resolveEventInstant(
        {
          startDate: body.startDate,
          startTime: body.startTime,
          startedAt: body.startedAt,
        },
        tz,
      );
      let endedAt: Date | null = null;
      if (durationKind === "ongoing") {
        if (body.endDate !== undefined) {
          endedAt = body.endDate
            ? resolveEventInstant(
                { startDate: body.endDate, startTime: body.endTime ?? "00:00" },
                tz,
              ) ?? null
            : null;
        } else if (body.endedAt) {
          endedAt = new Date(body.endedAt);
        }
      }
      const [row] = await db
        .insert(healthEvents)
        .values({
          householdId: auth.householdId,
          memberId: body.memberId,
          medicationId: body.medicationId ?? null,
          type: (body.type as typeof healthEvents.$inferInsert.type) ?? "other",
          title: enc.title!,
          notes: enc.notes ?? null,
          startedAt: startedAt ?? null,
          endedAt,
          durationKind,
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
        await replaceHealthEventShares(db, row.id, sharedMemberIds);
      }

      return c.json(
        {
          event: serializeHealthEvent(row, env, {
            sharedMemberIds,
            isOwnedByMe: true,
          }, tz),
        },
        201,
      );
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.patch("/events/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(healthEvents)
      .where(and(eq(healthEvents.id, id), eq(healthEvents.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (
      existing.visibility === "private" &&
      existing.createdByUserId !== auth.userId &&
      !canManageMemberHealth(auth.role, existing.memberId, auth.memberId)
    ) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = await c.req.json<{
      type?: string;
      title?: string;
      notes?: string | null;
      startedAt?: string | null;
      endedAt?: string | null;
      startDate?: string | null;
      startTime?: string | null;
      endDate?: string | null;
      endTime?: string | null;
      durationKind?: string;
      visibility?: string;
      sharedMemberIds?: string[];
      memberId?: string;
    }>();

    try {
      const tz = await householdTimezone(db, auth.householdId);
      const patch: Partial<typeof healthEvents.$inferInsert> = { updatedAt: new Date() };
      if (body.title !== undefined) {
        patch.title = encryptHealthField(body.title, env) ?? "";
      }
      if (body.notes !== undefined) patch.notes = encryptHealthField(body.notes, env);
      if (body.type !== undefined) patch.type = body.type as typeof patch.type;
      const startedInstant = resolveEventInstant(
        {
          startDate: body.startDate,
          startTime: body.startTime,
          startedAt: body.startedAt,
        },
        tz,
      );
      if (startedInstant !== undefined) patch.startedAt = startedInstant;
      if (body.durationKind !== undefined) {
        patch.durationKind = normalizeDurationKind(body.durationKind);
      }
      const nextDurationKind =
        body.durationKind !== undefined
          ? normalizeDurationKind(body.durationKind)
          : (existing.durationKind ?? "single_day");
      if (nextDurationKind === "ongoing") {
        if (body.endDate !== undefined) {
          patch.endedAt = body.endDate
            ? resolveEventInstant(
                { startDate: body.endDate, startTime: body.endTime ?? "00:00" },
                tz,
              ) ?? null
            : null;
        } else if (body.endedAt !== undefined) {
          patch.endedAt = body.endedAt ? new Date(body.endedAt) : null;
        }
      } else if (body.durationKind !== undefined) {
        patch.endedAt = null;
      }
      if (body.memberId !== undefined) {
        if (!canManageMemberHealth(auth.role, body.memberId, auth.memberId)) {
          return c.json({ error: "forbidden" }, 403);
        }
        patch.memberId = body.memberId;
      }
      if (body.visibility !== undefined) patch.visibility = normalizeHealthVisibility(body.visibility);

      const [row] = await db
        .update(healthEvents)
        .set(patch)
        .where(eq(healthEvents.id, id))
        .returning();

      if (body.sharedMemberIds !== undefined && row.visibility === "private") {
        const sharedMemberIds = await validateHealthShareMemberIds(
          db,
          auth.householdId,
          body.sharedMemberIds,
          auth.memberId,
        );
        await replaceHealthEventShares(db, row.id, sharedMemberIds);
      }
      if (row.visibility === "household") {
        await replaceHealthEventShares(db, row.id, []);
      }

      const shareMap = await loadHealthEventShareMap(
        db,
        row.visibility === "private" ? [row.id] : [],
      );
      return c.json({
        event: serializeHealthEvent(row, env, {
          sharedMemberIds: shareMap.get(row.id),
          isOwnedByMe: row.createdByUserId === auth.userId,
        }, tz),
      });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.delete("/events/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(healthEvents)
      .where(and(eq(healthEvents.id, id), eq(healthEvents.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (
      existing.createdByUserId !== auth.userId &&
      !canManageMemberHealth(auth.role, existing.memberId, auth.memberId)
    ) {
      return c.json({ error: "forbidden" }, 403);
    }
    await db.delete(healthEvents).where(eq(healthEvents.id, id));
    return c.json({ ok: true });
  });

  app.get("/medications", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(healthMedications)
      .where(healthMedicationVisibleWhere(db, auth))
      .orderBy(desc(healthMedications.createdAt));
    const medications = await enrichHealthMedications(db, env, auth, rows);
    return c.json({ medications });
  });

  app.post("/medications", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      memberId: string;
      name: string;
      dosage?: string;
      instructions?: string;
      scheduleKind?: string;
      schedule?: { times?: string[]; daysOfWeek?: number[] };
      reminderOffsets?: number[];
      startDate?: string;
      endDate?: string;
      enabled?: boolean;
      visibility?: string;
      sharedMemberIds?: string[];
    }>();

    if (!body.memberId || !body.name?.trim()) {
      return c.json({ error: "invalid_body" }, 400);
    }
    if (!canManageMemberHealth(auth.role, body.memberId, auth.memberId)) {
      return c.json({ error: "forbidden" }, 403);
    }

    try {
      let scheduleMeta: { scheduleKind: "scheduled" | "prn"; scheduleJson: string };
      try {
        scheduleMeta = normalizeMedSchedule(body);
      } catch {
        return c.json({ error: "scheduled_meds_require_times" }, 400);
      }

      const enc = encryptHealthTextFields(env, {
        name: body.name.trim(),
        dosage: body.dosage ?? null,
        instructions: body.instructions ?? null,
      });
      const visibility = normalizeHealthVisibility(body.visibility);
      const offsets =
        body.reminderOffsets?.filter((n) => typeof n === "number" && n >= 0) ?? [0];

      const [row] = await db
        .insert(healthMedications)
        .values({
          householdId: auth.householdId,
          memberId: body.memberId,
          name: enc.name!,
          dosage: enc.dosage ?? null,
          instructions: enc.instructions ?? null,
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
        await replaceHealthMedicationShares(db, row.id, sharedMemberIds);
      }

      return c.json(
        {
          medication: serializeHealthMedication(row, env, {
            sharedMemberIds,
            isOwnedByMe: true,
          }),
        },
        201,
      );
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.patch("/medications/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(healthMedications)
      .where(and(eq(healthMedications.id, id), eq(healthMedications.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (
      existing.visibility === "private" &&
      existing.createdByUserId !== auth.userId &&
      !canManageMemberHealth(auth.role, existing.memberId, auth.memberId)
    ) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = await c.req.json<{
      name?: string;
      dosage?: string | null;
      instructions?: string | null;
      scheduleKind?: string;
      schedule?: { times?: string[]; daysOfWeek?: number[] };
      reminderOffsets?: number[];
      startDate?: string | null;
      endDate?: string | null;
      enabled?: boolean;
      visibility?: string;
      sharedMemberIds?: string[];
      memberId?: string;
    }>();

    try {
      const patch: Partial<typeof healthMedications.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) patch.name = encryptHealthField(body.name, env) ?? "";
      if (body.dosage !== undefined) patch.dosage = encryptHealthField(body.dosage, env);
      if (body.instructions !== undefined) {
        patch.instructions = encryptHealthField(body.instructions, env);
      }
      if (body.scheduleKind !== undefined || body.schedule !== undefined) {
        const scheduleMeta = normalizeMedSchedule({
          scheduleKind: body.scheduleKind ?? existing.scheduleKind,
          schedule: body.schedule ?? parseMedSchedule(existing.scheduleJson),
        });
        patch.scheduleKind = scheduleMeta.scheduleKind;
        patch.scheduleJson = scheduleMeta.scheduleJson;
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
      if (body.memberId !== undefined) {
        if (!canManageMemberHealth(auth.role, body.memberId, auth.memberId)) {
          return c.json({ error: "forbidden" }, 403);
        }
        patch.memberId = body.memberId;
      }

      const [row] = await db
        .update(healthMedications)
        .set(patch)
        .where(eq(healthMedications.id, id))
        .returning();

      if (body.sharedMemberIds !== undefined && row.visibility === "private") {
        const sharedMemberIds = await validateHealthShareMemberIds(
          db,
          auth.householdId,
          body.sharedMemberIds,
          auth.memberId,
        );
        await replaceHealthMedicationShares(db, row.id, sharedMemberIds);
      }
      if (row.visibility === "household") {
        await replaceHealthMedicationShares(db, row.id, []);
      }

      const shareMap = await loadHealthMedicationShareMap(
        db,
        row.visibility === "private" ? [row.id] : [],
      );
      return c.json({
        medication: serializeHealthMedication(row, env, {
          sharedMemberIds: shareMap.get(row.id),
          isOwnedByMe: row.createdByUserId === auth.userId,
        }),
      });
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.delete("/medications/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [existing] = await db
      .select()
      .from(healthMedications)
      .where(and(eq(healthMedications.id, id), eq(healthMedications.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);
    if (
      existing.createdByUserId !== auth.userId &&
      !canManageMemberHealth(auth.role, existing.memberId, auth.memberId)
    ) {
      return c.json({ error: "forbidden" }, 403);
    }
    await db.delete(healthMedications).where(eq(healthMedications.id, id));
    return c.json({ ok: true });
  });

  app.post("/medications/:id/log", async (c) => {
    const auth = c.get("auth")!;
    const medId = c.req.param("id");
    const [med] = await db
      .select()
      .from(healthMedications)
      .where(and(eq(healthMedications.id, medId), eq(healthMedications.householdId, auth.householdId)))
      .limit(1);
    if (!med) return c.json({ error: "not_found" }, 404);
    if (!canManageMemberHealth(auth.role, med.memberId, auth.memberId)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const body = await c.req.json<{
      status?: string;
      scheduledAt?: string;
      loggedAt?: string;
      notes?: string;
      alsoCreateEvent?: boolean;
    }>();

    const status = body.status === "skipped" || body.status === "missed" ? body.status : "taken";
    const isPrn = med.scheduleKind === "prn";
    const alsoCreateEvent = body.alsoCreateEvent ?? isPrn;
    const loggedAt = body.loggedAt ? new Date(body.loggedAt) : new Date();
    let scheduledAt: Date | null = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (!isPrn && !scheduledAt) {
      return c.json({ error: "scheduled_at_required" }, 400);
    }

    try {
      let healthEventId: string | null = null;
      if (alsoCreateEvent && status === "taken") {
        const medName = decryptHealthFieldOrPassthrough(med.name, env) ?? "medication";
        const title = encryptHealthField(`Took ${medName}`, env)!;
        const notesEnc = body.notes ? encryptHealthField(body.notes, env) : null;
        const [eventRow] = await db
          .insert(healthEvents)
          .values({
            householdId: auth.householdId,
            memberId: med.memberId,
            medicationId: med.id,
            type: "medication",
            title,
            notes: notesEnc,
            startedAt: loggedAt,
            visibility: med.visibility,
            createdByUserId: auth.userId,
          })
          .returning();
        healthEventId = eventRow.id;
        if (med.visibility === "private") {
          const shares = await loadHealthMedicationShareMap(db, [med.id]);
          await replaceHealthEventShares(db, eventRow.id, shares.get(med.id) ?? []);
        }
      }

      const [logRow] = await db
        .insert(healthMedicationLogs)
        .values({
          medicationId: med.id,
          scheduledAt,
          status,
          loggedAt,
          loggedByUserId: auth.userId,
          notes: body.notes ? encryptHealthField(body.notes, env) : null,
          healthEventId,
        })
        .returning();

      return c.json({ log: serializeHealthLog(logRow, env), healthEventId }, 201);
    } catch (e) {
      const resp = encryptionErrorResponse(c, e);
      if (resp) return resp;
      throw e;
    }
  });

  app.get("/medications/:id/logs", async (c) => {
    const auth = c.get("auth")!;
    const medId = c.req.param("id");
    const [med] = await db
      .select()
      .from(healthMedications)
      .where(and(eq(healthMedications.id, medId), eq(healthMedications.householdId, auth.householdId)))
      .limit(1);
    if (!med) return c.json({ error: "not_found" }, 404);

    const visible = healthMedicationVisibleWhere(db, auth);
    const [check] = await db
      .select({ id: healthMedications.id })
      .from(healthMedications)
      .where(and(eq(healthMedications.id, medId), visible!))
      .limit(1);
    if (!check) return c.json({ error: "not_found" }, 404);

    const logs = await db
      .select()
      .from(healthMedicationLogs)
      .where(eq(healthMedicationLogs.medicationId, medId))
      .orderBy(desc(healthMedicationLogs.loggedAt))
      .limit(100);

    return c.json({ logs: logs.map((l) => serializeHealthLog(l, env)) });
  });

  return app;
}
