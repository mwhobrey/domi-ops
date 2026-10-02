import type { Database } from "@domi-ops/db";
import {
  healthCheckGroupMembers,
  healthCheckGroupShares,
  healthCheckGroups,
  healthCheckShares,
  healthChecks,
  healthMemberAcl,
} from "@domi-ops/db";
import { and, eq, exists, inArray, or } from "drizzle-orm";
import { aclExistsSql } from "./health-access.js";

/**
 * Visibility, shares and group membership for scheduled health checks (WHO-382). Mirrors the
 * medication helpers in health-access.ts, with one deliberate difference: checks ride the
 * `events` ACL segment (you are being asked to log an event), not `medications`/`doses`.
 */

type VisibilityAuth = { householdId: string; userId: string; memberId: string };

/**
 * A check is visible to: anyone when `visibility` is household, the subject, its creator, a
 * member it is shared with (private only), or a grantee with `events` read/write on the subject.
 * No admin override: admins do not auto-see private PHI (WHO-226).
 */
export function healthCheckVisibleWhere(db: Database, auth: VisibilityAuth) {
  return and(
    eq(healthChecks.householdId, auth.householdId),
    or(
      eq(healthChecks.visibility, "household"),
      eq(healthChecks.memberId, auth.memberId),
      and(eq(healthChecks.visibility, "private"), eq(healthChecks.createdByUserId, auth.userId)),
      and(
        eq(healthChecks.visibility, "private"),
        exists(
          db
            .select({ checkId: healthCheckShares.checkId })
            .from(healthCheckShares)
            .where(
              and(
                eq(healthCheckShares.checkId, healthChecks.id),
                eq(healthCheckShares.memberId, auth.memberId),
              ),
            ),
        ),
      ),
      aclExistsSql(db, auth.memberId, healthChecks.memberId, healthMemberAcl.eventsAccess, ["read", "write"]),
    ),
  );
}

/** Same rules as {@link healthCheckVisibleWhere}, for check groups. */
export function healthCheckGroupVisibleWhere(db: Database, auth: VisibilityAuth) {
  return and(
    eq(healthCheckGroups.householdId, auth.householdId),
    or(
      eq(healthCheckGroups.visibility, "household"),
      eq(healthCheckGroups.memberId, auth.memberId),
      and(eq(healthCheckGroups.visibility, "private"), eq(healthCheckGroups.createdByUserId, auth.userId)),
      and(
        eq(healthCheckGroups.visibility, "private"),
        exists(
          db
            .select({ groupId: healthCheckGroupShares.groupId })
            .from(healthCheckGroupShares)
            .where(
              and(
                eq(healthCheckGroupShares.groupId, healthCheckGroups.id),
                eq(healthCheckGroupShares.memberId, auth.memberId),
              ),
            ),
        ),
      ),
      aclExistsSql(db, auth.memberId, healthCheckGroups.memberId, healthMemberAcl.eventsAccess, ["read", "write"]),
    ),
  );
}

export async function loadHealthCheckShareMap(db: Database, checkIds: string[]) {
  const map = new Map<string, string[]>();
  if (checkIds.length === 0) return map;
  const rows = await db
    .select({ checkId: healthCheckShares.checkId, memberId: healthCheckShares.memberId })
    .from(healthCheckShares)
    .where(inArray(healthCheckShares.checkId, checkIds));
  for (const row of rows) {
    const list = map.get(row.checkId) ?? [];
    list.push(row.memberId);
    map.set(row.checkId, list);
  }
  return map;
}

export async function replaceHealthCheckShares(db: Database, checkId: string, memberIds: string[]) {
  await db.delete(healthCheckShares).where(eq(healthCheckShares.checkId, checkId));
  if (memberIds.length === 0) return;
  await db.insert(healthCheckShares).values(memberIds.map((memberId) => ({ checkId, memberId })));
}

export async function loadHealthCheckGroupShareMap(db: Database, groupIds: string[]) {
  const map = new Map<string, string[]>();
  if (groupIds.length === 0) return map;
  const rows = await db
    .select({ groupId: healthCheckGroupShares.groupId, memberId: healthCheckGroupShares.memberId })
    .from(healthCheckGroupShares)
    .where(inArray(healthCheckGroupShares.groupId, groupIds));
  for (const row of rows) {
    const list = map.get(row.groupId) ?? [];
    list.push(row.memberId);
    map.set(row.groupId, list);
  }
  return map;
}

export async function replaceHealthCheckGroupShares(db: Database, groupId: string, memberIds: string[]) {
  await db.delete(healthCheckGroupShares).where(eq(healthCheckGroupShares.groupId, groupId));
  if (memberIds.length === 0) return;
  await db.insert(healthCheckGroupShares).values(memberIds.map((memberId) => ({ groupId, memberId })));
}

/** checkId -> the groupIds it belongs to (many-to-many, like medications). */
export async function loadHealthCheckGroupMembershipMap(
  db: Database,
  checkIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (checkIds.length === 0) return map;
  const rows = await db
    .select({ checkId: healthCheckGroupMembers.checkId, groupId: healthCheckGroupMembers.groupId })
    .from(healthCheckGroupMembers)
    .where(inArray(healthCheckGroupMembers.checkId, checkIds));
  for (const row of rows) {
    const list = map.get(row.checkId) ?? [];
    list.push(row.groupId);
    map.set(row.checkId, list);
  }
  return map;
}

/** groupId -> the checkIds that belong to it. */
export async function loadGroupCheckIdsMap(db: Database, groupIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (groupIds.length === 0) return map;
  const rows = await db
    .select({ groupId: healthCheckGroupMembers.groupId, checkId: healthCheckGroupMembers.checkId })
    .from(healthCheckGroupMembers)
    .where(inArray(healthCheckGroupMembers.groupId, groupIds));
  for (const row of rows) {
    const list = map.get(row.groupId) ?? [];
    list.push(row.checkId);
    map.set(row.groupId, list);
  }
  return map;
}

/**
 * `memberId` must be the member of both the group and the check: the composite foreign keys on
 * health_check_group_members reject a mismatch (SQLSTATE 23503) as a backstop.
 */
export async function addCheckToGroup(db: Database, groupId: string, checkId: string, memberId: string) {
  await db.insert(healthCheckGroupMembers).values({ groupId, checkId, memberId }).onConflictDoNothing();
}

export async function removeCheckFromGroup(db: Database, groupId: string, checkId: string) {
  await db
    .delete(healthCheckGroupMembers)
    .where(and(eq(healthCheckGroupMembers.groupId, groupId), eq(healthCheckGroupMembers.checkId, checkId)));
}

export async function removeCheckFromAllGroups(db: Database, checkId: string) {
  await db.delete(healthCheckGroupMembers).where(eq(healthCheckGroupMembers.checkId, checkId));
}
