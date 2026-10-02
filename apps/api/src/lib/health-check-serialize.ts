import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import type { healthCheckGroups, healthCheckLogs, healthChecks } from "@domi-ops/db";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";
import {
  canAccessHealthSegment,
  loadHealthAclBySubjectForGrantee,
  managementGrantsForSubject,
} from "./health-access.js";
import { loadHealthCheckGroupMembershipMap, loadHealthCheckShareMap } from "./health-check-access.js";
import { parseCheckTemplate } from "./health-check-template.js";
import { parseMedSchedule } from "./health-serialize.js";

type HealthCheckRow = typeof healthChecks.$inferSelect;
type HealthCheckGroupRow = typeof healthCheckGroups.$inferSelect;
type HealthCheckLogRow = typeof healthCheckLogs.$inferSelect;

type Auth = { userId: string; memberId: string; householdId: string; role: string };

export type SerializedHealthCheck = ReturnType<typeof serializeHealthCheck>;

function parseOffsets(raw: string | null | undefined): number[] {
  if (!raw) return [0];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.filter((n): n is number => typeof n === "number");
  } catch {
    // fall through
  }
  return [0];
}

export function serializeHealthCheck(
  row: HealthCheckRow,
  env: Env,
  extras?: {
    sharedMemberIds?: string[];
    isOwnedByMe?: boolean;
    sharedWithMe?: boolean;
    canEdit?: boolean;
    canLog?: boolean;
    /** Groups this check belongs to (many-to-many). */
    groupIds?: string[];
  },
) {
  return {
    id: row.id,
    memberId: row.memberId,
    groupIds: extras?.groupIds ?? [],
    name: decryptHealthFieldOrPassthrough(row.name, env) ?? "",
    eventType: row.eventType,
    template: parseCheckTemplate(decryptHealthFieldOrPassthrough(row.templateJson, env)),
    scheduleKind: row.scheduleKind,
    schedule: parseMedSchedule(row.scheduleJson),
    reminderOffsets: parseOffsets(row.reminderOffsetsJson),
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

/**
 * Serialize with the caller's per-row flags. `canEdit` mirrors the PATCH/DELETE guard: creator,
 * or `events` write on the subject (WHO-339: household visibility is read-only). `canLog` is
 * `events` write, since logging a check creates an event.
 */
export async function enrichHealthChecks(db: Database, env: Env, auth: Auth, rows: HealthCheckRow[]) {
  const privateIds = rows.filter((r) => r.visibility === "private").map((r) => r.id);
  const shareMap = await loadHealthCheckShareMap(db, privateIds);
  const groupMembershipMap = await loadHealthCheckGroupMembershipMap(db, rows.map((r) => r.id));
  const aclBySubject = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);
  return rows.map((row) => {
    const sharedMemberIds = shareMap.get(row.id) ?? [];
    const isOwnedByMe = row.createdByUserId === auth.userId;
    const sharedWithMe =
      row.visibility === "private" && !isOwnedByMe && sharedMemberIds.includes(auth.memberId);
    const grants = managementGrantsForSubject(aclBySubject, row.memberId, auth.memberId, auth.role);
    const canEdit = isOwnedByMe || canAccessHealthSegment(grants, "events", "write");
    const canLog = canAccessHealthSegment(grants, "events", "write");
    return serializeHealthCheck(row, env, {
      sharedMemberIds: canEdit ? sharedMemberIds : undefined,
      isOwnedByMe,
      sharedWithMe,
      canEdit,
      canLog,
      groupIds: groupMembershipMap.get(row.id) ?? [],
    });
  });
}

export function serializeHealthCheckGroup(
  row: HealthCheckGroupRow,
  env: Env,
  checks: SerializedHealthCheck[],
  extras?: { sharedMemberIds?: string[]; isOwnedByMe?: boolean; canEdit?: boolean },
) {
  return {
    id: row.id,
    memberId: row.memberId,
    name: decryptHealthFieldOrPassthrough(row.name, env) ?? "",
    scheduleKind: row.scheduleKind,
    schedule: parseMedSchedule(row.scheduleJson),
    reminderOffsets: parseOffsets(row.reminderOffsetsJson),
    startDate: row.startDate,
    endDate: row.endDate,
    enabled: row.enabled,
    visibility: row.visibility,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    /** Only the member checks the caller is allowed to see. */
    checks,
    sharedMemberIds: extras?.sharedMemberIds,
    isOwnedByMe: extras?.isOwnedByMe,
    canEdit: extras?.canEdit,
  };
}

export function serializeHealthCheckLog(row: HealthCheckLogRow, env: Env) {
  return {
    id: row.id,
    checkId: row.checkId,
    scheduledAt: row.scheduledAt.toISOString(),
    status: row.status,
    loggedAt: row.loggedAt.toISOString(),
    loggedByUserId: row.loggedByUserId,
    notes: decryptHealthFieldOrPassthrough(row.notes, env),
    healthEventId: row.healthEventId,
  };
}
