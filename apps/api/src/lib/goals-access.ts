import { canProvisionMembers } from "@domi-ops/auth";
import { goals } from "@domi-ops/db";
import { and, eq, or } from "drizzle-orm";

/** Owner/admin can manage (edit/delete/log progress on/claim for) any goal; anyone else only
 *  their own. Same shape as health's canManageMemberHealth, minus the ACL layer goals doesn't have. */
export function canManageGoal(
  householdRole: string,
  ownerMemberId: string,
  authMemberId: string,
): boolean {
  if (canProvisionMembers(householdRole)) return true;
  return ownerMemberId === authMemberId;
}

/**
 * Unlike health (WHO-226: no admin override on private PHI, by design), goals give owner/admin
 * an override on private goals — they need to be able to see and approve a kid's private goal.
 */
export function goalVisibleWhere(auth: { householdId: string; memberId: string; role: string }) {
  const conditions = [
    eq(goals.visibility, "household"),
    eq(goals.ownerMemberId, auth.memberId),
  ];
  if (canProvisionMembers(auth.role)) {
    conditions.push(eq(goals.visibility, "private"));
  }
  return and(eq(goals.householdId, auth.householdId), or(...conditions));
}
