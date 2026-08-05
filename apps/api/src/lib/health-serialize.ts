import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import type {
  healthEvents,
  healthMedicationLogs,
  healthMedications,
} from "@domi-ops/db";
import { households } from "@domi-ops/db";
import {
  isMidnightInTz,
  localDateOfInstant,
  localTimeHhmm,
  normalizeIntervalSchedule,
  zonedLocalToUtc,
} from "@domi-ops/calendar-sync";
import { eq } from "drizzle-orm";
import {
  decryptHealthFieldOrPassthrough,
  encryptHealthField,
  HealthEncryptionError,
} from "./health-crypto.js";
import {
  canAccessHealthSegment,
  loadHealthAclBySubjectForGrantee,
  loadHealthEventShareMap,
  loadHealthMedicationShareMap,
  managementGrantsForSubject,
} from "./health-access.js";

type HealthEventRow = typeof healthEvents.$inferSelect;
type HealthMedicationRow = typeof healthMedications.$inferSelect;
type HealthLogRow = typeof healthMedicationLogs.$inferSelect;

export function serializeHealthEvent(
  row: HealthEventRow,
  env: Env,
  extras?: {
    sharedMemberIds?: string[];
    isOwnedByMe?: boolean;
    sharedWithMe?: boolean;
    canEdit?: boolean;
  },
  timeZone?: string,
) {
  const base = {
    id: row.id,
    memberId: row.memberId,
    medicationId: row.medicationId,
    type: row.type,
    title: decryptHealthFieldOrPassthrough(row.title, env) ?? "",
    notes: decryptHealthFieldOrPassthrough(row.notes, env),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    durationKind: row.durationKind,
    visibility: row.visibility,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sharedMemberIds: extras?.sharedMemberIds,
    isOwnedByMe: extras?.isOwnedByMe,
    sharedWithMe: extras?.sharedWithMe,
    canEdit: extras?.canEdit,
    startDate: null as string | null,
    startTime: null as string | null,
    endDate: null as string | null,
    endTime: null as string | null,
  };

  if (timeZone && row.startedAt) {
    base.startDate = localDateOfInstant(row.startedAt, timeZone);
    base.startTime = isMidnightInTz(row.startedAt, timeZone)
      ? null
      : localTimeHhmm(row.startedAt, timeZone);
  }
  if (timeZone && row.endedAt) {
    base.endDate = localDateOfInstant(row.endedAt, timeZone);
    base.endTime = isMidnightInTz(row.endedAt, timeZone)
      ? null
      : localTimeHhmm(row.endedAt, timeZone);
  }

  return base;
}

export function resolveEventInstant(
  body: {
    startedAt?: string | null;
    startDate?: string | null;
    startTime?: string | null;
  },
  timeZone: string,
): Date | null | undefined {
  if (body.startDate !== undefined) {
    const date = body.startDate?.trim();
    if (!date) return null;
    const time = body.startTime?.trim() || "00:00";
    return zonedLocalToUtc(date, time.slice(0, 5), timeZone);
  }
  if (body.startedAt !== undefined) {
    return body.startedAt ? new Date(body.startedAt) : null;
  }
  return undefined;
}

export function serializeHealthMedication(
  row: HealthMedicationRow,
  env: Env,
  extras?: {
    sharedMemberIds?: string[];
    isOwnedByMe?: boolean;
    sharedWithMe?: boolean;
    canEdit?: boolean;
    canLog?: boolean;
  },
) {
  return {
    id: row.id,
    memberId: row.memberId,
    name: decryptHealthFieldOrPassthrough(row.name, env) ?? "",
    dosage: decryptHealthFieldOrPassthrough(row.dosage, env),
    instructions: decryptHealthFieldOrPassthrough(row.instructions, env),
    scheduleKind: row.scheduleKind,
    schedule: parseJsonObject(row.scheduleJson),
    reminderOffsets: parseJsonNumberArray(row.reminderOffsetsJson),
    startDate: row.startDate,
    endDate: row.endDate,
    enabled: row.enabled,
    visibility: row.visibility,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sharedMemberIds: extras?.sharedMemberIds,
    isOwnedByMe: extras?.isOwnedByMe,
    sharedWithMe: extras?.sharedWithMe,
    canEdit: extras?.canEdit,
    canLog: extras?.canLog,
  };
}

export function serializeHealthLog(row: HealthLogRow, env: Env) {
  return {
    id: row.id,
    medicationId: row.medicationId,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    status: row.status,
    loggedAt: row.loggedAt.toISOString(),
    loggedByUserId: row.loggedByUserId,
    notes: decryptHealthFieldOrPassthrough(row.notes, env),
    healthEventId: row.healthEventId,
  };
}

export async function enrichHealthEvents(
  db: Database,
  env: Env,
  auth: { userId: string; memberId: string; householdId: string; role: string },
  rows: HealthEventRow[],
  timeZone?: string,
) {
  let tz = timeZone;
  if (!tz) {
    const [household] = await db
      .select({ timezone: households.timezone })
      .from(households)
      .where(eq(households.id, auth.householdId))
      .limit(1);
    tz = household?.timezone ?? "UTC";
  }
  const privateIds = rows.filter((r) => r.visibility === "private").map((r) => r.id);
  const shareMap = await loadHealthEventShareMap(db, privateIds);
  const aclBySubject = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);
  return rows.map((row) => {
    const sharedMemberIds = shareMap.get(row.id) ?? [];
    const isOwnedByMe = row.createdByUserId === auth.userId;
    const sharedWithMe =
      row.visibility === "private" && !isOwnedByMe && sharedMemberIds.includes(auth.memberId);
    const grants = managementGrantsForSubject(
      aclBySubject,
      row.memberId,
      auth.memberId,
      auth.role,
    );
    const canEdit =
      isOwnedByMe ||
      row.visibility === "household" ||
      canAccessHealthSegment(grants, "events", "write");
    return serializeHealthEvent(row, env, {
      sharedMemberIds: isOwnedByMe ? sharedMemberIds : undefined,
      isOwnedByMe,
      sharedWithMe,
      canEdit,
    }, tz);
  });
}

export async function enrichHealthMedications(
  db: Database,
  env: Env,
  auth: { userId: string; memberId: string; householdId: string; role: string },
  rows: HealthMedicationRow[],
) {
  const privateIds = rows.filter((r) => r.visibility === "private").map((r) => r.id);
  const shareMap = await loadHealthMedicationShareMap(db, privateIds);
  const aclBySubject = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);
  return rows.map((row) => {
    const sharedMemberIds = shareMap.get(row.id) ?? [];
    const isOwnedByMe = row.createdByUserId === auth.userId;
    const sharedWithMe =
      row.visibility === "private" && !isOwnedByMe && sharedMemberIds.includes(auth.memberId);
    const grants = managementGrantsForSubject(
      aclBySubject,
      row.memberId,
      auth.memberId,
      auth.role,
    );
    const canEdit =
      isOwnedByMe ||
      row.visibility === "household" ||
      canAccessHealthSegment(grants, "medications", "write");
    const canLog = canAccessHealthSegment(grants, "doses", "write");
    return serializeHealthMedication(row, env, {
      sharedMemberIds: isOwnedByMe ? sharedMemberIds : undefined,
      isOwnedByMe,
      sharedWithMe,
      canEdit,
      canLog,
    });
  });
}

export function encryptHealthTextFields(
  env: Env,
  fields: { title?: string; notes?: string | null; name?: string; dosage?: string | null; instructions?: string | null },
) {
  try {
    const out: Record<string, string | null | undefined> = {};
    if (fields.title !== undefined) out.title = encryptHealthField(fields.title, env) ?? "";
    if (fields.notes !== undefined) out.notes = encryptHealthField(fields.notes, env);
    if (fields.name !== undefined) out.name = encryptHealthField(fields.name, env) ?? "";
    if (fields.dosage !== undefined) out.dosage = encryptHealthField(fields.dosage, env);
    if (fields.instructions !== undefined) {
      out.instructions = encryptHealthField(fields.instructions, env);
    }
    return out;
  } catch (e) {
    if (e instanceof HealthEncryptionError) throw e;
    throw e;
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJsonNumberArray(raw: string | null | undefined): number[] {
  if (!raw) return [0];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.filter((n): n is number => typeof n === "number");
  } catch {
    // ignore
  }
  return [0];
}

export function parseMedSchedule(raw: string | null | undefined): {
  times?: string[];
  daysOfWeek?: number[];
  everyMinutes?: number;
  anchor?: string;
  fixedStartTime?: string;
  intervalFrom?: string;
  stop?: { mode?: string; maxDoses?: number; endTime?: string };
} {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      times: Array.isArray(parsed.times)
        ? parsed.times.filter((t): t is string => typeof t === "string")
        : [],
      daysOfWeek: Array.isArray(parsed.daysOfWeek)
        ? parsed.daysOfWeek.filter((d): d is number => typeof d === "number")
        : undefined,
      everyMinutes: typeof parsed.everyMinutes === "number" ? parsed.everyMinutes : undefined,
      anchor: typeof parsed.anchor === "string" ? parsed.anchor : undefined,
      fixedStartTime: typeof parsed.fixedStartTime === "string" ? parsed.fixedStartTime : undefined,
      intervalFrom: typeof parsed.intervalFrom === "string" ? parsed.intervalFrom : undefined,
      stop:
        parsed.stop && typeof parsed.stop === "object"
          ? (parsed.stop as { mode?: string; maxDoses?: number; endTime?: string })
          : undefined,
    };
  } catch {
    return {};
  }
}

export function normalizeMedSchedule(body: {
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
}) {
  if (body.scheduleKind === "prn") {
    return { scheduleKind: "prn" as const, scheduleJson: "{}" };
  }
  if (body.scheduleKind === "interval") {
    const schedule = normalizeIntervalSchedule({
      everyMinutes: body.schedule?.everyMinutes,
      anchor: body.schedule?.anchor,
      fixedStartTime: body.schedule?.fixedStartTime,
      intervalFrom: body.schedule?.intervalFrom,
      stop: body.schedule?.stop,
    });
    return { scheduleKind: "interval" as const, scheduleJson: JSON.stringify(schedule) };
  }
  const kind = "scheduled" as const;
  const times = (body.schedule?.times ?? []).filter((t) => typeof t === "string" && t.includes(":"));
  if (times.length === 0) {
    throw new Error("scheduled_meds_require_times");
  }
  const daysOfWeek = body.schedule?.daysOfWeek?.filter((d) => typeof d === "number" && d >= 0 && d <= 6);
  const schedule = daysOfWeek?.length ? { times, daysOfWeek } : { times };
  return { scheduleKind: kind, scheduleJson: JSON.stringify(schedule) };
}
