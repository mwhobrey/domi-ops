import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import type {
  healthEvents,
  healthMedicationLogs,
  healthMedications,
} from "@domi-ops/db";
import {
  households,
  healthVitalsReadings,
  healthExerciseDetails,
  healthPainLogs,
  healthFoodLogEntries,
} from "@domi-ops/db";
import {
  isMidnightInTz,
  localDateOfInstant,
  localTimeHhmm,
  normalizeIntervalSchedule,
  zonedLocalToUtc,
} from "@domi-ops/calendar-sync";
import { eq, inArray } from "drizzle-orm";
import {
  decryptHealthFieldOrPassthrough,
  encryptHealthField,
  HealthEncryptionError,
} from "./health-crypto.js";
import {
  canAccessHealthSegment,
  loadHealthAclBySubjectForGrantee,
  loadHealthEventShareMap,
  loadHealthMedicationGroupMembershipMap,
  loadHealthMedicationShareMap,
  managementGrantsForSubject,
} from "./health-access.js";

type HealthEventRow = typeof healthEvents.$inferSelect;
type HealthMedicationRow = typeof healthMedications.$inferSelect;
type HealthLogRow = typeof healthMedicationLogs.$inferSelect;
type HealthVitalsReadingRow = typeof healthVitalsReadings.$inferSelect;
type HealthExerciseDetailRow = typeof healthExerciseDetails.$inferSelect;
type HealthPainLogRow = typeof healthPainLogs.$inferSelect;
type HealthFoodLogEntryRow = typeof healthFoodLogEntries.$inferSelect;

export type SerializedVitalsReading = {
  id: string;
  metric: string;
  value: number | null;
  unit: string;
  createdAt: string;
};

export function serializeHealthVitalsReading(
  row: HealthVitalsReadingRow,
  env: Env,
): SerializedVitalsReading {
  const decrypted = decryptHealthFieldOrPassthrough(row.value, env);
  const parsed = decrypted != null ? Number(decrypted) : null;
  return {
    id: row.id,
    metric: row.metric,
    value: parsed != null && Number.isFinite(parsed) ? parsed : null,
    unit: row.unit,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Batch-load and decrypt readings for a set of health_events ids, grouped by eventId. */
export async function loadVitalsReadingsForEvents(
  db: Database,
  env: Env,
  eventIds: string[],
): Promise<Map<string, SerializedVitalsReading[]>> {
  const map = new Map<string, SerializedVitalsReading[]>();
  if (eventIds.length === 0) return map;
  const rows = await db
    .select()
    .from(healthVitalsReadings)
    .where(inArray(healthVitalsReadings.eventId, eventIds));
  for (const row of rows) {
    const list = map.get(row.eventId) ?? [];
    list.push(serializeHealthVitalsReading(row, env));
    map.set(row.eventId, list);
  }
  return map;
}

export async function replaceVitalsReadings(
  db: Database,
  env: Env,
  eventId: string,
  readings: Array<{ metric: string; value: number; unit: string }>,
): Promise<void> {
  // Encrypt before touching the DB — if a field fails to encrypt (e.g. HealthEncryptionError),
  // nothing has been deleted yet. The delete + insert then run in one transaction so an insert
  // failure (e.g. a constraint violation) can't leave the delete committed with no replacement.
  const values = readings.map((r) => ({
    eventId,
    metric: r.metric as typeof healthVitalsReadings.$inferInsert.metric,
    value: encryptHealthField(String(r.value), env)!,
    unit: r.unit,
  }));
  await db.transaction(async (tx) => {
    await tx.delete(healthVitalsReadings).where(eq(healthVitalsReadings.eventId, eventId));
    if (values.length > 0) {
      await tx.insert(healthVitalsReadings).values(values);
    }
  });
}

function decryptedNumberOrNull(value: string | null, env: Env): number | null {
  if (value == null) return null;
  const decrypted = decryptHealthFieldOrPassthrough(value, env);
  if (decrypted == null) return null;
  const parsed = Number(decrypted);
  return Number.isFinite(parsed) ? parsed : null;
}

export type SerializedExerciseDetail = {
  id: string;
  activity: string;
  durationMinutes: number | null;
  intensity: string | null;
  distance: number | null;
  distanceUnit: string | null;
  sets: number | null;
  reps: number | null;
  caloriesEstimated: number | null;
  externalSource: string;
  externalId: string | null;
  createdAt: string;
};

export function serializeHealthExerciseDetail(
  row: HealthExerciseDetailRow,
  env: Env,
): SerializedExerciseDetail {
  return {
    id: row.id,
    activity: decryptHealthFieldOrPassthrough(row.activity, env) ?? "",
    durationMinutes: decryptedNumberOrNull(row.durationMinutes, env),
    intensity: row.intensity,
    distance: decryptedNumberOrNull(row.distance, env),
    distanceUnit: row.distanceUnit,
    sets: decryptedNumberOrNull(row.sets, env),
    reps: decryptedNumberOrNull(row.reps, env),
    caloriesEstimated: decryptedNumberOrNull(row.caloriesEstimated, env),
    externalSource: row.externalSource,
    externalId: row.externalId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Batch-load and decrypt exercise details for a set of health_events ids, grouped by eventId. */
export async function loadExerciseDetailsForEvents(
  db: Database,
  env: Env,
  eventIds: string[],
): Promise<Map<string, SerializedExerciseDetail[]>> {
  const map = new Map<string, SerializedExerciseDetail[]>();
  if (eventIds.length === 0) return map;
  const rows = await db
    .select()
    .from(healthExerciseDetails)
    .where(inArray(healthExerciseDetails.eventId, eventIds));
  for (const row of rows) {
    const list = map.get(row.eventId) ?? [];
    list.push(serializeHealthExerciseDetail(row, env));
    map.set(row.eventId, list);
  }
  return map;
}

export type ExerciseDetailInput = {
  activity: string;
  durationMinutes?: number | null;
  intensity?: string | null;
  distance?: number | null;
  distanceUnit?: string | null;
  sets?: number | null;
  reps?: number | null;
  caloriesEstimated?: number | null;
};

export async function replaceExerciseDetails(
  db: Database,
  env: Env,
  eventId: string,
  details: ExerciseDetailInput[],
): Promise<void> {
  // Encrypt before touching the DB — if a field fails to encrypt (e.g. HealthEncryptionError),
  // nothing has been deleted yet. The delete + insert then run in one transaction so an insert
  // failure (e.g. a constraint violation) can't leave the delete committed with no replacement.
  const values = details.map((d) => ({
    eventId,
    activity: encryptHealthField(d.activity, env)!,
    durationMinutes:
      d.durationMinutes != null ? encryptHealthField(String(d.durationMinutes), env) : null,
    intensity: d.intensity ?? null,
    distance: d.distance != null ? encryptHealthField(String(d.distance), env) : null,
    distanceUnit: d.distanceUnit ?? null,
    sets: d.sets != null ? encryptHealthField(String(d.sets), env) : null,
    reps: d.reps != null ? encryptHealthField(String(d.reps), env) : null,
    caloriesEstimated:
      d.caloriesEstimated != null ? encryptHealthField(String(d.caloriesEstimated), env) : null,
  }));
  await db.transaction(async (tx) => {
    await tx.delete(healthExerciseDetails).where(eq(healthExerciseDetails.eventId, eventId));
    if (values.length > 0) {
      await tx.insert(healthExerciseDetails).values(values);
    }
  });
}

export type SerializedPainLog = {
  id: string;
  bodyRegion: string;
  severity: number;
  qualityTags: string[] | null;
  createdAt: string;
};

export function serializeHealthPainLog(row: HealthPainLogRow, env: Env): SerializedPainLog {
  const severity = decryptedNumberOrNull(row.severity, env) ?? 0;
  const tagsRaw = row.qualityTags != null ? decryptHealthFieldOrPassthrough(row.qualityTags, env) : null;
  let qualityTags: string[] | null = null;
  if (tagsRaw) {
    try {
      const parsed = JSON.parse(tagsRaw);
      if (Array.isArray(parsed)) {
        qualityTags = parsed.filter((t): t is string => typeof t === "string");
      }
    } catch {
      // malformed JSON — leave qualityTags null rather than fail the whole event
    }
  }
  return {
    id: row.id,
    bodyRegion: row.bodyRegion,
    severity,
    qualityTags,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Batch-load and decrypt pain logs for a set of health_events ids, grouped by eventId. */
export async function loadPainLogsForEvents(
  db: Database,
  env: Env,
  eventIds: string[],
): Promise<Map<string, SerializedPainLog[]>> {
  const map = new Map<string, SerializedPainLog[]>();
  if (eventIds.length === 0) return map;
  const rows = await db
    .select()
    .from(healthPainLogs)
    .where(inArray(healthPainLogs.eventId, eventIds));
  for (const row of rows) {
    const list = map.get(row.eventId) ?? [];
    list.push(serializeHealthPainLog(row, env));
    map.set(row.eventId, list);
  }
  return map;
}

export type PainLogInput = {
  bodyRegion: string;
  severity: number;
  qualityTags?: string[] | null;
};

export async function replacePainLogs(
  db: Database,
  env: Env,
  eventId: string,
  logs: PainLogInput[],
): Promise<void> {
  // Encrypt before touching the DB — if a field fails to encrypt (e.g. HealthEncryptionError),
  // nothing has been deleted yet. The delete + insert then run in one transaction so an insert
  // failure (e.g. a constraint violation) can't leave the delete committed with no replacement.
  const values = logs.map((l) => ({
    eventId,
    bodyRegion: l.bodyRegion as typeof healthPainLogs.$inferInsert.bodyRegion,
    severity: encryptHealthField(String(l.severity), env)!,
    qualityTags:
      l.qualityTags && l.qualityTags.length > 0
        ? encryptHealthField(JSON.stringify(l.qualityTags), env)
        : null,
  }));
  await db.transaction(async (tx) => {
    await tx.delete(healthPainLogs).where(eq(healthPainLogs.eventId, eventId));
    if (values.length > 0) {
      await tx.insert(healthPainLogs).values(values);
    }
  });
}

export type SerializedFoodLogEntry = {
  id: string;
  foodName: string;
  quantity: number | null;
  unit: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  source: string;
  createdAt: string;
};

export function serializeHealthFoodLogEntry(
  row: HealthFoodLogEntryRow,
  env: Env,
): SerializedFoodLogEntry {
  return {
    id: row.id,
    foodName: decryptHealthFieldOrPassthrough(row.foodName, env) ?? "",
    quantity: decryptedNumberOrNull(row.quantity, env),
    unit: row.unit,
    calories: decryptedNumberOrNull(row.calories, env),
    proteinG: decryptedNumberOrNull(row.proteinG, env),
    carbsG: decryptedNumberOrNull(row.carbsG, env),
    fatG: decryptedNumberOrNull(row.fatG, env),
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Batch-load and decrypt food log entries for a set of health_events ids, grouped by eventId. */
export async function loadFoodLogEntriesForEvents(
  db: Database,
  env: Env,
  eventIds: string[],
): Promise<Map<string, SerializedFoodLogEntry[]>> {
  const map = new Map<string, SerializedFoodLogEntry[]>();
  if (eventIds.length === 0) return map;
  const rows = await db
    .select()
    .from(healthFoodLogEntries)
    .where(inArray(healthFoodLogEntries.eventId, eventIds));
  for (const row of rows) {
    const list = map.get(row.eventId) ?? [];
    list.push(serializeHealthFoodLogEntry(row, env));
    map.set(row.eventId, list);
  }
  return map;
}

export type FoodLogEntryInput = {
  foodName: string;
  quantity: number;
  unit: string;
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
};

export async function replaceFoodLogEntries(
  db: Database,
  env: Env,
  eventId: string,
  entries: FoodLogEntryInput[],
): Promise<void> {
  // Encrypt before touching the DB — if a field fails to encrypt (e.g. HealthEncryptionError),
  // nothing has been deleted yet. The delete + insert then run in one transaction so an insert
  // failure (e.g. a constraint violation) can't leave the delete committed with no replacement.
  const values = entries.map((f) => ({
    eventId,
    foodName: encryptHealthField(f.foodName, env)!,
    quantity: encryptHealthField(String(f.quantity), env)!,
    unit: f.unit,
    calories: f.calories != null ? encryptHealthField(String(f.calories), env) : null,
    proteinG: f.proteinG != null ? encryptHealthField(String(f.proteinG), env) : null,
    carbsG: f.carbsG != null ? encryptHealthField(String(f.carbsG), env) : null,
    fatG: f.fatG != null ? encryptHealthField(String(f.fatG), env) : null,
  }));
  await db.transaction(async (tx) => {
    await tx.delete(healthFoodLogEntries).where(eq(healthFoodLogEntries.eventId, eventId));
    if (values.length > 0) {
      await tx.insert(healthFoodLogEntries).values(values);
    }
  });
}

export function serializeHealthEvent(
  row: HealthEventRow,
  env: Env,
  extras?: {
    sharedMemberIds?: string[];
    isOwnedByMe?: boolean;
    sharedWithMe?: boolean;
    canEdit?: boolean;
    readings?: SerializedVitalsReading[];
    exerciseDetails?: SerializedExerciseDetail[];
    painLogs?: SerializedPainLog[];
    foodLogEntries?: SerializedFoodLogEntry[];
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
    readings: row.type === "vitals" ? (extras?.readings ?? []) : undefined,
    exerciseDetails: row.type === "exercise" ? (extras?.exerciseDetails ?? []) : undefined,
    painLogs: row.type === "pain" ? (extras?.painLogs ?? []) : undefined,
    foodLogEntries: row.type === "food_intake" ? (extras?.foodLogEntries ?? []) : undefined,
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
    /** Groups this medication belongs to (many-to-many — see healthMedicationGroupMembers). */
    groupIds?: string[];
  },
) {
  return {
    id: row.id,
    memberId: row.memberId,
    groupIds: extras?.groupIds ?? [],
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
  const vitalsEventIds = rows.filter((r) => r.type === "vitals").map((r) => r.id);
  const readingsMap = await loadVitalsReadingsForEvents(db, env, vitalsEventIds);
  const exerciseEventIds = rows.filter((r) => r.type === "exercise").map((r) => r.id);
  const exerciseDetailsMap = await loadExerciseDetailsForEvents(db, env, exerciseEventIds);
  const painEventIds = rows.filter((r) => r.type === "pain").map((r) => r.id);
  const painLogsMap = await loadPainLogsForEvents(db, env, painEventIds);
  const foodEventIds = rows.filter((r) => r.type === "food_intake").map((r) => r.id);
  const foodLogEntriesMap = await loadFoodLogEntriesForEvents(db, env, foodEventIds);
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
      sharedMemberIds: canEdit ? sharedMemberIds : undefined,
      isOwnedByMe,
      sharedWithMe,
      readings: readingsMap.get(row.id),
      exerciseDetails: exerciseDetailsMap.get(row.id),
      painLogs: painLogsMap.get(row.id),
      foodLogEntries: foodLogEntriesMap.get(row.id),
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
  const groupMembershipMap = await loadHealthMedicationGroupMembershipMap(db, rows.map((r) => r.id));
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
      sharedMemberIds: canEdit ? sharedMemberIds : undefined,
      isOwnedByMe,
      sharedWithMe,
      canEdit,
      canLog,
      groupIds: groupMembershipMap.get(row.id) ?? [],
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
