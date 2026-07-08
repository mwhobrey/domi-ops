import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { homeStatus, householdMembers, households } from "@domi-ops/db";
import { asc, eq } from "drizzle-orm";
import { ensureHomeStatusRow } from "./home-status.js";
import { hasImportRecords } from "./import-records.js";
import { memberShownLabel } from "./member-label.js";

/** Oldest household — canonical tenant root in DEPLOYMENT_MODE=single. */
export async function getCanonicalHouseholdId(db: Database): Promise<string | null> {
  const [row] = await db
    .select({ id: households.id })
    .from(households)
    .orderBy(asc(households.createdAt))
    .limit(1);
  return row?.id ?? null;
}

async function countOwners(db: Database, householdId: string): Promise<number> {
  const rows = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));
  return rows.filter((r) => r.role === "owner").length;
}

export async function joinExistingHousehold(
  db: Database,
  householdId: string,
  userId: string,
  memberName: string,
): Promise<string> {
  const owners = await countOwners(db, householdId);
  const role = owners === 0 ? "owner" : "member";

  const [member] = await db
    .insert(householdMembers)
    .values({
      householdId,
      userId,
      role,
      name: memberName,
    })
    .returning({
      id: householdMembers.id,
      name: householdMembers.name,
    });

  await ensureHomeStatusRow(
    db,
    householdId,
    member.id,
    memberShownLabel(member),
  );

  return householdId;
}

/**
 * In single-tenant mode, a second Google/email login must not keep a shadow household.
 * Moves the user onto the canonical household and deletes an empty orphan tenant.
 */
export async function repairSingleTenantMembership(
  db: Database,
  env: Env,
  userId: string,
): Promise<boolean> {
  if (env.DEPLOYMENT_MODE !== "single") return false;
  if (await hasImportRecords(db)) return false;

  const canonicalId = await getCanonicalHouseholdId(db);
  if (!canonicalId) return false;

  const [membership] = await db
    .select({
      id: householdMembers.id,
      householdId: householdMembers.householdId,
      role: householdMembers.role,
      name: householdMembers.name,
    })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  if (!membership || membership.householdId === canonicalId) return false;

  const orphanHouseholdId = membership.householdId;
  const memberName =
    membership.name?.trim() || "Member";

  await db.delete(homeStatus).where(eq(homeStatus.memberId, membership.id));
  await db.delete(householdMembers).where(eq(householdMembers.id, membership.id));

  const [remaining] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, orphanHouseholdId))
    .limit(1);
  if (!remaining) {
    await db.delete(households).where(eq(households.id, orphanHouseholdId));
  }

  await joinExistingHousehold(db, canonicalId, userId, memberName);
  return true;
}
