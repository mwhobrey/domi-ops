import type { Database } from "@domi-ops/db";
import {
  healthEventShares,
  healthEvents,
  healthMedicationGroupMembers,
  healthMedicationGroupShares,
  healthMedicationGroups,
  healthMedicationShares,
  healthMedications,
  healthMemberAcl,
  householdMembers,
} from "@domi-ops/db";
import { and, eq, exists, inArray, or, type AnyColumn } from "drizzle-orm";
import { isHouseholdAdmin } from "./school-access.js";

export type HealthVisibility = "household" | "private";

export type HealthAclLevel = "none" | "read" | "write";

export type HealthAclSegment = "events" | "medications" | "doses" | "reports";

export type HealthAclGrants = {
  events: HealthAclLevel;
  medications: HealthAclLevel;
  doses: HealthAclLevel;
  reports: HealthAclLevel;
};

const ACL_RANK: Record<HealthAclLevel, number> = { none: 0, read: 1, write: 2 };

/** Omit / unknown → private (WHO-226). Only explicit `"household"` opens the record. */
export function normalizeHealthVisibility(value: unknown): HealthVisibility {
  return value === "household" ? "household" : "private";
}

export function normalizeHealthAclLevel(value: unknown): HealthAclLevel {
  if (value === "read" || value === "write" || value === "none") return value;
  return "none";
}

export function aclLevelAtLeast(level: HealthAclLevel, min: HealthAclLevel): boolean {
  return ACL_RANK[level] >= ACL_RANK[min];
}

/**
 * Doses write implies medications read (WHO-229) so caregivers can see meds they log against.
 * Does not escalate medications write.
 */
export function effectiveMedicationsAccess(grants: HealthAclGrants): HealthAclLevel {
  if (aclLevelAtLeast(grants.medications, "read")) return grants.medications;
  if (grants.doses === "write") return "read";
  return "none";
}

export function emptyHealthAclGrants(): HealthAclGrants {
  return { events: "none", medications: "none", doses: "none", reports: "none" };
}

export function fullHealthAclGrants(): HealthAclGrants {
  return { events: "write", medications: "write", doses: "write", reports: "write" };
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

export async function loadHealthMedicationGroupShareMap(db: Database, groupIds: string[]) {
  const map = new Map<string, string[]>();
  if (groupIds.length === 0) return map;
  const rows = await db
    .select({
      groupId: healthMedicationGroupShares.groupId,
      memberId: healthMedicationGroupShares.memberId,
    })
    .from(healthMedicationGroupShares)
    .where(inArray(healthMedicationGroupShares.groupId, groupIds));
  for (const row of rows) {
    const list = map.get(row.groupId) ?? [];
    list.push(row.memberId);
    map.set(row.groupId, list);
  }
  return map;
}

export async function replaceHealthMedicationGroupShares(
  db: Database,
  groupId: string,
  memberIds: string[],
) {
  await db
    .delete(healthMedicationGroupShares)
    .where(eq(healthMedicationGroupShares.groupId, groupId));
  if (memberIds.length === 0) return;
  await db.insert(healthMedicationGroupShares).values(
    memberIds.map((memberId) => ({ groupId, memberId })),
  );
}

/** medicationId -> the groupIds it belongs to (many-to-many — a med can be in several). */
export async function loadHealthMedicationGroupMembershipMap(
  db: Database,
  medicationIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (medicationIds.length === 0) return map;
  const rows = await db
    .select({
      medicationId: healthMedicationGroupMembers.medicationId,
      groupId: healthMedicationGroupMembers.groupId,
    })
    .from(healthMedicationGroupMembers)
    .where(inArray(healthMedicationGroupMembers.medicationId, medicationIds));
  for (const row of rows) {
    const list = map.get(row.medicationId) ?? [];
    list.push(row.groupId);
    map.set(row.medicationId, list);
  }
  return map;
}

/** groupId -> the medicationIds that belong to it. */
export async function loadGroupMemberMedicationIdsMap(
  db: Database,
  groupIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (groupIds.length === 0) return map;
  const rows = await db
    .select({
      groupId: healthMedicationGroupMembers.groupId,
      medicationId: healthMedicationGroupMembers.medicationId,
    })
    .from(healthMedicationGroupMembers)
    .where(inArray(healthMedicationGroupMembers.groupId, groupIds));
  for (const row of rows) {
    const list = map.get(row.groupId) ?? [];
    list.push(row.medicationId);
    map.set(row.groupId, list);
  }
  return map;
}

export async function addMedicationToGroup(db: Database, groupId: string, medicationId: string) {
  await db
    .insert(healthMedicationGroupMembers)
    .values({ groupId, medicationId })
    .onConflictDoNothing();
}

export async function removeMedicationFromGroup(db: Database, groupId: string, medicationId: string) {
  await db
    .delete(healthMedicationGroupMembers)
    .where(
      and(
        eq(healthMedicationGroupMembers.groupId, groupId),
        eq(healthMedicationGroupMembers.medicationId, medicationId),
      ),
    );
}

export async function removeMedicationFromAllGroups(db: Database, medicationId: string) {
  await db
    .delete(healthMedicationGroupMembers)
    .where(eq(healthMedicationGroupMembers.medicationId, medicationId));
}

function rowToGrants(row: {
  eventsAccess: HealthAclLevel;
  medicationsAccess: HealthAclLevel;
  dosesAccess: HealthAclLevel;
  reportsAccess: HealthAclLevel;
}): HealthAclGrants {
  return {
    events: row.eventsAccess,
    medications: row.medicationsAccess,
    doses: row.dosesAccess,
    reports: row.reportsAccess,
  };
}

/** ACL rows where auth is grantee (subject → grants). */
export async function loadHealthAclBySubjectForGrantee(
  db: Database,
  householdId: string,
  granteeMemberId: string,
): Promise<Map<string, HealthAclGrants>> {
  const map = new Map<string, HealthAclGrants>();
  const rows = await db
    .select()
    .from(healthMemberAcl)
    .where(
      and(
        eq(healthMemberAcl.householdId, householdId),
        eq(healthMemberAcl.granteeMemberId, granteeMemberId),
      ),
    );
  for (const row of rows) {
    map.set(row.subjectMemberId, rowToGrants(row));
  }
  return map;
}

/** ACL rows for a subject (grantee → grants) — for sharing UI. */
export async function loadHealthAclForSubject(
  db: Database,
  householdId: string,
  subjectMemberId: string,
): Promise<Array<{ granteeMemberId: string } & HealthAclGrants>> {
  const rows = await db
    .select()
    .from(healthMemberAcl)
    .where(
      and(
        eq(healthMemberAcl.householdId, householdId),
        eq(healthMemberAcl.subjectMemberId, subjectMemberId),
      ),
    );
  return rows.map((row) => ({
    granteeMemberId: row.granteeMemberId,
    ...rowToGrants(row),
  }));
}

export async function replaceHealthAclForSubject(
  db: Database,
  householdId: string,
  subjectMemberId: string,
  entries: Array<{ granteeMemberId: string } & HealthAclGrants>,
) {
  await db
    .delete(healthMemberAcl)
    .where(
      and(
        eq(healthMemberAcl.householdId, householdId),
        eq(healthMemberAcl.subjectMemberId, subjectMemberId),
      ),
    );
  const values = entries
    .filter((e) => e.granteeMemberId && e.granteeMemberId !== subjectMemberId)
    .filter(
      (e) =>
        e.events !== "none" ||
        e.medications !== "none" ||
        e.doses !== "none" ||
        e.reports !== "none",
    )
    .map((e) => ({
      householdId,
      subjectMemberId,
      granteeMemberId: e.granteeMemberId,
      eventsAccess: e.events,
      medicationsAccess: e.medications,
      dosesAccess: e.doses,
      reportsAccess: e.reports,
      updatedAt: new Date(),
    }));
  if (values.length === 0) return;
  await db.insert(healthMemberAcl).values(values);
}

/**
 * Management grants for UI / write checks: subject + household admin get full write.
 * Do **not** use for list visibility — admins must not auto-see private PHI (WHO-226).
 */
export function managementGrantsForSubject(
  aclBySubject: Map<string, HealthAclGrants>,
  subjectMemberId: string,
  authMemberId: string,
  householdRole: string,
): HealthAclGrants {
  if (canManageMemberHealth(householdRole, subjectMemberId, authMemberId)) {
    return fullHealthAclGrants();
  }
  return aclBySubject.get(subjectMemberId) ?? emptyHealthAclGrants();
}

/** Raw ACL row only — for visibility (no admin override). */
export function visibilityGrantsForSubject(
  aclBySubject: Map<string, HealthAclGrants>,
  subjectMemberId: string,
): HealthAclGrants {
  return aclBySubject.get(subjectMemberId) ?? emptyHealthAclGrants();
}

export function canAccessHealthSegment(
  grants: HealthAclGrants,
  segment: HealthAclSegment,
  min: HealthAclLevel,
): boolean {
  if (segment === "medications") {
    return aclLevelAtLeast(effectiveMedicationsAccess(grants), min);
  }
  return aclLevelAtLeast(grants[segment], min);
}

export async function hasHealthSegmentAccess(
  db: Database,
  auth: { householdId: string; memberId: string; role: string },
  subjectMemberId: string,
  segment: HealthAclSegment,
  min: HealthAclLevel,
): Promise<boolean> {
  if (canManageMemberHealth(auth.role, subjectMemberId, auth.memberId)) return true;
  const map = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);
  return canAccessHealthSegment(map.get(subjectMemberId) ?? emptyHealthAclGrants(), segment, min);
}

function aclExistsSql(
  db: Database,
  authMemberId: string,
  subjectMemberIdCol: AnyColumn,
  accessCol:
    | typeof healthMemberAcl.eventsAccess
    | typeof healthMemberAcl.medicationsAccess
    | typeof healthMemberAcl.dosesAccess
    | typeof healthMemberAcl.reportsAccess,
  levels: HealthAclLevel[],
) {
  return exists(
    db
      .select({ id: healthMemberAcl.subjectMemberId })
      .from(healthMemberAcl)
      .where(
        and(
          eq(healthMemberAcl.subjectMemberId, subjectMemberIdCol),
          eq(healthMemberAcl.granteeMemberId, authMemberId),
          inArray(accessCol, levels),
        ),
      ),
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
      eq(healthEvents.memberId, auth.memberId),
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
      aclExistsSql(db, auth.memberId, healthEvents.memberId, healthMemberAcl.eventsAccess, [
        "read",
        "write",
      ]),
    ),
  );
}

/** Events visible for reports: list visibility OR reports segment ≥ read. */
export function healthEventReportsVisibleWhere(db: Database, auth: {
  householdId: string;
  userId: string;
  memberId: string;
}) {
  return and(
    eq(healthEvents.householdId, auth.householdId),
    or(
      eq(healthEvents.visibility, "household"),
      eq(healthEvents.memberId, auth.memberId),
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
      aclExistsSql(db, auth.memberId, healthEvents.memberId, healthMemberAcl.eventsAccess, [
        "read",
        "write",
      ]),
      aclExistsSql(db, auth.memberId, healthEvents.memberId, healthMemberAcl.reportsAccess, [
        "read",
        "write",
      ]),
    ),
  );
}

/** Same visibility rules as healthMedicationVisibleWhere, for medication groups. */
export function healthMedicationGroupVisibleWhere(db: Database, auth: {
  householdId: string;
  userId: string;
  memberId: string;
}) {
  return and(
    eq(healthMedicationGroups.householdId, auth.householdId),
    or(
      eq(healthMedicationGroups.visibility, "household"),
      eq(healthMedicationGroups.memberId, auth.memberId),
      and(
        eq(healthMedicationGroups.visibility, "private"),
        eq(healthMedicationGroups.createdByUserId, auth.userId),
      ),
      and(
        eq(healthMedicationGroups.visibility, "private"),
        exists(
          db
            .select({ groupId: healthMedicationGroupShares.groupId })
            .from(healthMedicationGroupShares)
            .where(
              and(
                eq(healthMedicationGroupShares.groupId, healthMedicationGroups.id),
                eq(healthMedicationGroupShares.memberId, auth.memberId),
              ),
            ),
        ),
      ),
      aclExistsSql(
        db,
        auth.memberId,
        healthMedicationGroups.memberId,
        healthMemberAcl.medicationsAccess,
        ["read", "write"],
      ),
      aclExistsSql(db, auth.memberId, healthMedicationGroups.memberId, healthMemberAcl.dosesAccess, [
        "write",
      ]),
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
      eq(healthMedications.memberId, auth.memberId),
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
      aclExistsSql(
        db,
        auth.memberId,
        healthMedications.memberId,
        healthMemberAcl.medicationsAccess,
        ["read", "write"],
      ),
      // doses write ⇒ meds read
      aclExistsSql(db, auth.memberId, healthMedications.memberId, healthMemberAcl.dosesAccess, [
        "write",
      ]),
    ),
  );
}

export function healthMedicationReportsVisibleWhere(db: Database, auth: {
  householdId: string;
  userId: string;
  memberId: string;
}) {
  return and(
    eq(healthMedications.householdId, auth.householdId),
    or(
      eq(healthMedications.visibility, "household"),
      eq(healthMedications.memberId, auth.memberId),
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
      aclExistsSql(
        db,
        auth.memberId,
        healthMedications.memberId,
        healthMemberAcl.medicationsAccess,
        ["read", "write"],
      ),
      aclExistsSql(db, auth.memberId, healthMedications.memberId, healthMemberAcl.dosesAccess, [
        "write",
      ]),
      aclExistsSql(
        db,
        auth.memberId,
        healthMedications.memberId,
        healthMemberAcl.reportsAccess,
        ["read", "write"],
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
  /** Effective segment access for this record's subject (events or meds). */
  segmentAccess?: HealthAclLevel;
}): boolean {
  const {
    visibility,
    createdByUserId,
    authUserId,
    authMemberId,
    sharedMemberIds,
    householdRole,
    recordMemberId,
    segmentAccess = "none",
  } = params;
  // No admin override — matches SQL VisibleWhere (list/reports/overlays).
  if (visibility === "household") return true;
  if (recordMemberId === authMemberId) return true;
  if (createdByUserId === authUserId) return true;
  if (sharedMemberIds.includes(authMemberId)) return true;
  if (aclLevelAtLeast(segmentAccess, "read")) return true;
  void householdRole;
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
  const aclBySubject = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);

  const visible = new Set<string>();
  for (const row of rows) {
    const grants = visibilityGrantsForSubject(aclBySubject, row.memberId);
    if (
      isHealthRecordVisible({
        visibility: row.visibility,
        createdByUserId: row.createdByUserId,
        authUserId: auth.userId,
        authMemberId: auth.memberId,
        sharedMemberIds: shareMap.get(row.id) ?? [],
        householdRole: auth.role,
        recordMemberId: row.memberId,
        segmentAccess: grants.events,
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
  const aclBySubject = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);

  const visible = new Set<string>();
  for (const row of rows) {
    const grants = visibilityGrantsForSubject(aclBySubject, row.memberId);
    if (
      isHealthRecordVisible({
        visibility: row.visibility,
        createdByUserId: row.createdByUserId,
        authUserId: auth.userId,
        authMemberId: auth.memberId,
        sharedMemberIds: shareMap.get(row.id) ?? [],
        householdRole: auth.role,
        recordMemberId: row.memberId,
        segmentAccess: effectiveMedicationsAccess(grants),
      })
    ) {
      visible.add(row.id);
    }
  }
  return visible;
}

/** Capabilities for current user across subjects (for UI gating). Includes admin/self full write. */
export async function loadHealthCapabilities(
  db: Database,
  auth: { householdId: string; memberId: string; role: string },
  memberIds: string[],
): Promise<Record<string, HealthAclGrants>> {
  const aclBySubject = await loadHealthAclBySubjectForGrantee(db, auth.householdId, auth.memberId);
  const out: Record<string, HealthAclGrants> = {};
  for (const id of memberIds) {
    out[id] = managementGrantsForSubject(aclBySubject, id, auth.memberId, auth.role);
  }
  return out;
}
