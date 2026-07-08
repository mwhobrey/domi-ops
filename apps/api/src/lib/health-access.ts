import type { Database } from "@domi-ops/db";
import {
  healthEventShares,
  healthEvents,
  healthMedicationShares,
  healthMedications,
  householdMembers,
} from "@domi-ops/db";
import { and, eq, exists, inArray, or } from "drizzle-orm";
import { isHouseholdAdmin } from "./school-access.js";

export type HealthVisibility = "household" | "private";

export function normalizeHealthVisibility(value: unknown): HealthVisibility {
  return value === "private" ? "private" : "household";
}

export function canManageMemberHealth(householdRole: string, targetMemberId: string, authMemberId: string): boolean {
  if (isHouseholdAdmin(householdRole)) return true;
  return targetMemberId === authMemberId;
}

export async function loadHealthEventShareMap(db: Database, eventIds: string[]) {
  const map = new Map<string, string[]>();
  if (eventIds.length === 0) return map;
  const rows = await db
    .select({ eventId: healthEventShares.eventId, memberId: healthEventShares.memberId })
    .from(healthEventShares)
    .where(inArray(healthEventShares.eventId, eventIds));
  for (const row of rows) {
    const list = map.get(row.eventId) ?? [];
    list.push(row.memberId);
    map.set(row.eventId, list);
  }
  return map;
}

export async function loadHealthMedicationShareMap(db: Database, medicationIds: string[]) {
  const map = new Map<string, string[]>();
  if (medicationIds.length === 0) return map;
  const rows = await db
    .select({
      medicationId: healthMedicationShares.medicationId,
      memberId: healthMedicationShares.memberId,
    })
    .from(healthMedicationShares)
    .where(inArray(healthMedicationShares.medicationId, medicationIds));
  for (const row of rows) {
    const list = map.get(row.medicationId) ?? [];
    list.push(row.memberId);
    map.set(row.medicationId, list);
  }
  return map;
}

export async function validateHealthShareMemberIds(
  db: Database,
  householdId: string,
  memberIds: string[],
  excludeMemberId?: string,
) {
  const unique = [...new Set(memberIds.filter((id) => id && id !== excludeMemberId))];
  if (unique.length === 0) return [];
  const rows = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(eq(householdMembers.householdId, householdId), inArray(householdMembers.id, unique)),
    );
  const valid = new Set(rows.map((r) => r.id));
  return unique.filter((id) => valid.has(id));
}

export async function replaceHealthEventShares(
  db: Database,
  eventId: string,
  memberIds: string[],
) {
  await db.delete(healthEventShares).where(eq(healthEventShares.eventId, eventId));
  if (memberIds.length === 0) return;
  await db.insert(healthEventShares).values(
    memberIds.map((memberId) => ({ eventId, memberId })),
  );
}

export async function replaceHealthMedicationShares(
  db: Database,
  medicationId: string,
  memberIds: string[],
) {
  await db
    .delete(healthMedicationShares)
    .where(eq(healthMedicationShares.medicationId, medicationId));
  if (memberIds.length === 0) return;
  await db.insert(healthMedicationShares).values(
    memberIds.map((memberId) => ({ medicationId, memberId })),
  );
}

export function healthEventVisibleWhere(db: Database, auth: {
  householdId: string;
  userId: string;
  memberId: string;
}) {
  return and(
    eq(healthEvents.householdId, auth.householdId),
    or(
      eq(healthEvents.visibility, "household"),
      and(eq(healthEvents.visibility, "private"), eq(healthEvents.createdByUserId, auth.userId)),
      and(
        eq(healthEvents.visibility, "private"),
        exists(
          db
            .select({ eventId: healthEventShares.eventId })
            .from(healthEventShares)
            .where(
              and(
                eq(healthEventShares.eventId, healthEvents.id),
                eq(healthEventShares.memberId, auth.memberId),
              ),
            ),
        ),
      ),
    ),
  );
}

export function healthMedicationVisibleWhere(db: Database, auth: {
  householdId: string;
  userId: string;
  memberId: string;
}) {
  return and(
    eq(healthMedications.householdId, auth.householdId),
    or(
      eq(healthMedications.visibility, "household"),
      and(
        eq(healthMedications.visibility, "private"),
        eq(healthMedications.createdByUserId, auth.userId),
      ),
      and(
        eq(healthMedications.visibility, "private"),
        exists(
          db
            .select({ medicationId: healthMedicationShares.medicationId })
            .from(healthMedicationShares)
            .where(
              and(
                eq(healthMedicationShares.medicationId, healthMedications.id),
                eq(healthMedicationShares.memberId, auth.memberId),
              ),
            ),
        ),
      ),
    ),
  );
}

export function isHealthRecordVisible(params: {
  visibility: HealthVisibility;
  createdByUserId: string | null;
  authUserId: string;
  authMemberId: string;
  sharedMemberIds: string[];
  householdRole: string;
  recordMemberId: string;
}): boolean {
  const {
    visibility,
    createdByUserId,
    authUserId,
    authMemberId,
    sharedMemberIds,
    householdRole,
    recordMemberId,
  } = params;
  if (isHouseholdAdmin(householdRole)) return true;
  if (visibility === "household") return true;
  if (createdByUserId === authUserId) return true;
  if (sharedMemberIds.includes(authMemberId)) return true;
  if (recordMemberId === authMemberId) return true;
  return false;
}

export async function filterVisibleHealthEventIds(
  db: Database,
  auth: { householdId: string; userId: string; memberId: string; role: string },
  eventIds: string[],
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const rows = await db
    .select({
      id: healthEvents.id,
      visibility: healthEvents.visibility,
      createdByUserId: healthEvents.createdByUserId,
      memberId: healthEvents.memberId,
    })
    .from(healthEvents)
    .where(and(eq(healthEvents.householdId, auth.householdId), inArray(healthEvents.id, eventIds)));

  const privateIds = rows.filter((r) => r.visibility === "private").map((r) => r.id);
  const shareMap = await loadHealthEventShareMap(db, privateIds);

  const visible = new Set<string>();
  for (const row of rows) {
    if (
      isHealthRecordVisible({
        visibility: row.visibility,
        createdByUserId: row.createdByUserId,
        authUserId: auth.userId,
        authMemberId: auth.memberId,
        sharedMemberIds: shareMap.get(row.id) ?? [],
        householdRole: auth.role,
        recordMemberId: row.memberId,
      })
    ) {
      visible.add(row.id);
    }
  }
  return visible;
}

export async function filterVisibleMedicationIds(
  db: Database,
  auth: { householdId: string; userId: string; memberId: string; role: string },
  medicationIds: string[],
): Promise<Set<string>> {
  if (medicationIds.length === 0) return new Set();
  const rows = await db
    .select({
      id: healthMedications.id,
      visibility: healthMedications.visibility,
      createdByUserId: healthMedications.createdByUserId,
      memberId: healthMedications.memberId,
    })
    .from(healthMedications)
    .where(
      and(eq(healthMedications.householdId, auth.householdId), inArray(healthMedications.id, medicationIds)),
    );

  const privateIds = rows.filter((r) => r.visibility === "private").map((r) => r.id);
  const shareMap = await loadHealthMedicationShareMap(db, privateIds);

  const visible = new Set<string>();
  for (const row of rows) {
    if (
      isHealthRecordVisible({
        visibility: row.visibility,
        createdByUserId: row.createdByUserId,
        authUserId: auth.userId,
        authMemberId: auth.memberId,
        sharedMemberIds: shareMap.get(row.id) ?? [],
        householdRole: auth.role,
        recordMemberId: row.memberId,
      })
    ) {
      visible.add(row.id);
    }
  }
  return visible;
}
