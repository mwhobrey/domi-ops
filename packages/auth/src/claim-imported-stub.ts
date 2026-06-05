import type { Env } from "@whome/config";
import { isImportedStubEmail, parseHouseholdMemberEmailMap } from "@whome/config";
import type { Database } from "@whome/db";
import { baAccounts, householdMembers, users } from "@whome/db";
import { and, eq, ilike } from "drizzle-orm";

export type LoginProfile = {
  email: string;
  displayName?: string;
  imageUrl?: string;
  emailVerified?: boolean;
};

/** Reassign stub household_members row to the real logged-in user. */
export async function tryClaimImportedStubMember(
  db: Database,
  env: Env,
  householdId: string,
  realUserId: string,
  profile: LoginProfile,
): Promise<{ memberId: string } | null> {
  const emailMap = parseHouseholdMemberEmailMap(env.HOUSEHOLD_MEMBER_EMAIL_MAP);
  const legacyCandidates = [
    emailMap.get(profile.email.toLowerCase()),
    profile.displayName?.trim(),
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

  for (const legacyName of legacyCandidates) {
    const claimed = await claimStubByLegacyName(db, householdId, realUserId, legacyName, profile);
    if (claimed) return claimed;
  }

  return null;
}

async function claimStubByLegacyName(
  db: Database,
  householdId: string,
  realUserId: string,
  legacyName: string,
  profile: LoginProfile,
): Promise<{ memberId: string } | null> {
  const [alreadyMember] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, realUserId),
      ),
    )
    .limit(1);
  if (alreadyMember) return null;

  const rows = await db
    .select({
      memberId: householdMembers.id,
      stubUserId: users.id,
      stubEmail: users.email,
      name: householdMembers.name,
      nickname: householdMembers.nickname,
      publicLabel: householdMembers.publicLabel,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        ilike(householdMembers.legacyDisplayName, legacyName),
      ),
    );

  for (const row of rows) {
    if (!isImportedStubEmail(row.stubEmail)) continue;

    const displayName = profile.displayName?.trim().slice(0, 128) || row.name;

    await db
      .update(householdMembers)
      .set({
        userId: realUserId,
        name: displayName ?? row.name,
      })
      .where(eq(householdMembers.id, row.memberId));

    await db.delete(baAccounts).where(eq(baAccounts.userId, row.stubUserId));
    await db.delete(users).where(eq(users.id, row.stubUserId));

    await db
      .update(users)
      .set({
        displayName: displayName ?? undefined,
        imageUrl: profile.imageUrl ?? undefined,
        emailVerified: profile.emailVerified ?? true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, realUserId));

    return { memberId: row.memberId };
  }

  return null;
}
