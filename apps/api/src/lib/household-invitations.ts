import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { householdInvitations, households, withSystemContext, type Database } from "@domi-ops/db";

export const INVITATION_COOKIE = "domi_household_invitation";
export const invitationTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export function activeInvitationWhere(token: string) {
  return and(eq(householdInvitations.tokenHash, invitationTokenHash(token)),
    isNull(householdInvitations.revokedAt), isNull(householdInvitations.acceptedAt), gt(householdInvitations.expiresAt, new Date()));
}
export async function lookupHouseholdInvitation(db: Database, token: string) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return withSystemContext(db, async (tx) => {
    const [row] = await tx.select({ invitation: householdInvitations, householdName: households.name })
      .from(householdInvitations).innerJoin(households, eq(householdInvitations.householdId, households.id))
      .where(activeInvitationWhere(token)).limit(1);
    return row ?? null;
  });
}
