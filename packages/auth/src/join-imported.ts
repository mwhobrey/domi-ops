import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { homeStatus, householdMembers, households } from "@whome/db";
import { and, eq, ne } from "drizzle-orm";
import { tryClaimImportedStubMember, type LoginProfile } from "./claim-imported-stub.js";
import { findOrCreateUser } from "./bootstrap.js";
import { getImportedHouseholdId } from "./import-records.js";
import { ensureHomeStatusRow } from "./home-status.js";
import { memberShownLabel } from "./member-label.js";

function defaultNameFromProfile(profile: LoginProfile): string {
  const fromGoogle = profile.displayName?.trim();
  if (fromGoogle) return fromGoogle.slice(0, 128);
  if (profile.username) return profile.username.slice(0, 128);
  const local = profile.email?.split("@")[0] ?? "member";
  return local.slice(0, 128);
}

async function removeMembershipOnOtherHouseholds(
  db: Database,
  userId: string,
  keepHouseholdId: string,
): Promise<void> {
  const otherMemberships = await db
    .select({
      id: householdMembers.id,
      householdId: householdMembers.householdId,
    })
    .from(householdMembers)
    .where(
      and(eq(householdMembers.userId, userId), ne(householdMembers.householdId, keepHouseholdId)),
    );

  for (const membership of otherMemberships) {
    await db.delete(homeStatus).where(eq(homeStatus.memberId, membership.id));
    await db.delete(householdMembers).where(eq(householdMembers.id, membership.id));

    const [remaining] = await db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, membership.householdId))
      .limit(1);
    if (!remaining) {
      await db.delete(households).where(eq(households.id, membership.householdId));
    }
  }
}

/** Attach Google/email/username user to the imported household. */
export async function joinImportedHousehold(
  db: Database,
  env: Env,
  profile: LoginProfile & { userId?: string },
): Promise<{ userId: string; householdId: string }> {
  const householdId = await getImportedHouseholdId(db);
  if (!householdId) {
    throw new Error("No imported household found");
  }

  const user = profile.userId
    ? { id: profile.userId }
    : profile.email
      ? await findOrCreateUser(db, {
          email: profile.email,
          displayName: profile.displayName,
          imageUrl: profile.imageUrl,
          emailVerified: profile.emailVerified,
        })
      : null;
  if (!user) {
    throw new Error("Imported household join requires userId or email");
  }

  const name = defaultNameFromProfile(profile);

  const claimed = await tryClaimImportedStubMember(db, env, householdId, user.id, profile);
  if (claimed) {
    await removeMembershipOnOtherHouseholds(db, user.id, householdId);
    const [claimedMember] = await db
      .select({
        id: householdMembers.id,
        name: householdMembers.name,
      })
      .from(householdMembers)
      .where(eq(householdMembers.id, claimed.memberId))
      .limit(1);
    if (claimedMember) {
      await ensureHomeStatusRow(
        db,
        householdId,
        claimedMember.id,
        memberShownLabel(claimedMember),
      );
    }
    return { userId: user.id, householdId };
  }

  const [onImported] = await db
    .select({
      id: householdMembers.id,
      name: householdMembers.name,
    })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, user.id),
      ),
    )
    .limit(1);

  if (onImported) {
    if (!onImported.name) {
      await db.update(householdMembers).set({ name }).where(eq(householdMembers.id, onImported.id));
      onImported.name = name;
    }
    await ensureHomeStatusRow(
      db,
      householdId,
      onImported.id,
      memberShownLabel(onImported),
    );
    await removeMembershipOnOtherHouseholds(db, user.id, householdId);
    return { userId: user.id, householdId };
  }

  await removeMembershipOnOtherHouseholds(db, user.id, householdId);

  const [anyMember] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .limit(1);

  const [member] = await db
    .insert(householdMembers)
    .values({
      householdId,
      userId: user.id,
      role: anyMember ? "member" : "owner",
      name,
    })
    .returning({
      id: householdMembers.id,
      name: householdMembers.name,
    });

  await ensureHomeStatusRow(db, householdId, member.id, memberShownLabel(member));
  return { userId: user.id, householdId };
}
