import type { Env } from "@whome/config";
import {
  collectLegacyNameCandidates,
  isImportedStubEmail,
  legacyDisplayNameMatches,
  parseHouseholdMemberEmailMap,
} from "@whome/config";
import type { Database } from "@whome/db";
import { baAccounts, householdMembers, importRecords, users } from "@whome/db";
import { and, eq } from "drizzle-orm";

export type LoginProfile = {
  email?: string;
  displayName?: string;
  imageUrl?: string;
  emailVerified?: boolean;
  username?: string;
};

type StubRow = {
  memberId: string;
  stubUserId: string;
  stubEmail: string | null;
  name: string | null;
  legacyDisplayName: string | null;
  importClaimEmail: string | null;
};

async function finalizeStubClaim(
  db: Database,
  realUserId: string,
  row: StubRow,
  profile: LoginProfile,
): Promise<{ memberId: string }> {
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
      importClaimEmail: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, realUserId));

  return { memberId: row.memberId };
}

async function loadStubRows(db: Database, householdId: string): Promise<StubRow[]> {
  return db
    .select({
      memberId: householdMembers.id,
      stubUserId: users.id,
      stubEmail: users.email,
      name: householdMembers.name,
      legacyDisplayName: householdMembers.legacyDisplayName,
      importClaimEmail: users.importClaimEmail,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, householdId));
}

async function userAlreadyOnHousehold(
  db: Database,
  householdId: string,
  realUserId: string,
): Promise<boolean> {
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
  return Boolean(alreadyMember);
}

async function stubMatchesImportEmail(
  db: Database,
  householdId: string,
  row: StubRow,
  email: string,
): Promise<boolean> {
  if (row.importClaimEmail?.toLowerCase() === email) return true;

  const [mapped] = await db
    .select({ id: importRecords.id })
    .from(importRecords)
    .where(
      and(
        eq(importRecords.householdId, householdId),
        eq(importRecords.sourceTable, "homehub_claim_email"),
        eq(importRecords.sourceId, email),
        eq(importRecords.targetId, row.memberId),
      ),
    )
    .limit(1);
  return Boolean(mapped);
}

/** Reassign stub household_members row to the real logged-in user. */
export async function tryClaimImportedStubMember(
  db: Database,
  env: Env,
  householdId: string,
  realUserId: string,
  profile: LoginProfile,
): Promise<{ memberId: string } | null> {
  if (await userAlreadyOnHousehold(db, householdId, realUserId)) return null;

  const email = profile.email?.trim().toLowerCase();
  if (email) {
    for (const row of await loadStubRows(db, householdId)) {
      if (!isImportedStubEmail(row.stubEmail)) continue;
      if (!(await stubMatchesImportEmail(db, householdId, row, email))) continue;
      return finalizeStubClaim(db, realUserId, row, profile);
    }
  }

  const emailMap = parseHouseholdMemberEmailMap(env.HOUSEHOLD_MEMBER_EMAIL_MAP);
  const legacyCandidates = collectLegacyNameCandidates({
    email: profile.email,
    displayName: profile.displayName,
    username: profile.username,
    emailToLegacyName: emailMap,
  });

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
  if (await userAlreadyOnHousehold(db, householdId, realUserId)) return null;

  for (const row of await loadStubRows(db, householdId)) {
    if (!isImportedStubEmail(row.stubEmail)) continue;
    const legacyLabel = row.legacyDisplayName ?? row.name ?? "";
    if (!legacyDisplayNameMatches(legacyName, legacyLabel)) continue;
    return finalizeStubClaim(db, realUserId, row, profile);
  }

  return null;
}
