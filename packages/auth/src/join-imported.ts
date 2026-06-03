import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { homeStatus, householdMembers, households, users } from "@whome/db";
import { and, eq } from "drizzle-orm";
import { findOrCreateUser } from "./bootstrap.js";
import { getImportedHouseholdId } from "./import-records.js";
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

async function ensureHomeStatusRow(
  db: Database,
  householdId: string,
  memberId: string,
  label: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: homeStatus.id })
    .from(homeStatus)
    .where(and(eq(homeStatus.householdId, householdId), eq(homeStatus.memberId, memberId)))
    .limit(1);
  if (existing) {
    await db
      .update(homeStatus)
      .set({ name: label.slice(0, 64), updatedAt: new Date() })
      .where(eq(homeStatus.id, existing.id));
    return;
  }
  await db.insert(homeStatus).values({
    householdId,
    memberId,
    name: label.slice(0, 64),
    status: "Away",
  });
}

/** Attach Google user to the imported household (no HomeHub nickname map). */
export async function joinImportedHousehold(
  db: Database,
  _env: Env,
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

  const [onImported] = await db
    .select({
      id: householdMembers.id,
      name: householdMembers.name,
      nickname: householdMembers.nickname,
      publicLabel: householdMembers.publicLabel,
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
      publicLabel: "name",
    })
    .returning({
      id: householdMembers.id,
      name: householdMembers.name,
      nickname: householdMembers.nickname,
      publicLabel: householdMembers.publicLabel,
    });

  await ensureHomeStatusRow(db, householdId, member.id, memberShownLabel(member));
  return { userId: user.id, householdId };
}
