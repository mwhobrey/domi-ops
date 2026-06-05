import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { householdMembers, households, users } from "@whome/db";
import { and, eq } from "drizzle-orm";
import { tryClaimImportedStubMember } from "./claim-imported-stub.js";
import { findOrCreateUser } from "./bootstrap.js";
import { getImportedHouseholdId } from "./import-records.js";
import { ensureHomeStatusRow } from "./home-status.js";
import { memberShownLabel } from "./member-label.js";

function defaultNameFromProfile(profile: {
  displayName?: string;
  email: string;
}): string {
  const fromGoogle = profile.displayName?.trim();
  if (fromGoogle) return fromGoogle.slice(0, 128);
  const local = profile.email.split("@")[0] ?? "member";
  return local.slice(0, 128);
}

/** Attach Google user to the imported household. */
export async function joinImportedHousehold(
  db: Database,
  env: Env,
  profile: {
    email: string;
    displayName?: string;
    imageUrl?: string;
    emailVerified?: boolean;
  },
): Promise<{ userId: string; householdId: string }> {
  const householdId = await getImportedHouseholdId(db);
  if (!householdId) {
    throw new Error("No imported household found");
  }

  const user = await findOrCreateUser(db, profile);
  const name = defaultNameFromProfile(profile);

  const claimed = await tryClaimImportedStubMember(db, env, householdId, user.id, profile);
  if (claimed) {
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
    return { userId: user.id, householdId };
  }

  const [otherHousehold] = await db
    .select({ id: householdMembers.id, householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, user.id))
    .limit(1);

  if (otherHousehold && otherHousehold.householdId !== householdId) {
    await db.delete(householdMembers).where(eq(householdMembers.id, otherHousehold.id));
    const [remaining] = await db
      .select({ id: households.id })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, otherHousehold.householdId))
      .limit(1);
    if (!remaining) {
      await db.delete(households).where(eq(households.id, otherHousehold.householdId));
    }
  }

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
