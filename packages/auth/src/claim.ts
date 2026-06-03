import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { householdMembers, importRecords, users } from "@whome/db";
import { and, eq } from "drizzle-orm";
import { bootstrapHouseholdOnLogin, findOrCreateUser } from "./bootstrap.js";
import { hasImportRecords } from "./import-records.js";

export class HouseholdClaimError extends Error {
  constructor(public code: "no_household" | "already_claimed") {
    super(code);
  }
}

function parseMemberEmailMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const part of raw.split(",")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim().toLowerCase();
    const email = part.slice(idx + 1).trim().toLowerCase();
    if (name && email) map.set(name, email);
  }
  return map;
}

function isPlaceholderEmail(email: string): boolean {
  return email.endsWith("@imported.local");
}

async function ensureOwnerIfNone(
  db: Database,
  householdId: string,
  memberId: string,
): Promise<void> {
  const [owner] = await db
    .select()
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.role, "owner")))
    .limit(1);
  if (!owner) {
    await db
      .update(householdMembers)
      .set({ role: "owner" })
      .where(eq(householdMembers.id, memberId));
  }
}

export async function tryClaimImportedMember(
  db: Database,
  env: Env,
  profile: { email: string; displayName?: string; imageUrl?: string; emailVerified?: boolean },
): Promise<{ userId: string; householdId: string } | null> {
  const email = profile.email.toLowerCase();
  const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existingUser) {
    const [member] = await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, existingUser.id))
      .limit(1);
    if (member) return { userId: existingUser.id, householdId: member.householdId };
  }

  const [importRow] = await db
    .select({ householdId: importRecords.householdId })
    .from(importRecords)
    .limit(1);
  if (!importRow) return null;

  const householdId = importRow.householdId;
  const emailMap = parseMemberEmailMap(env.HOUSEHOLD_MEMBER_EMAIL_MAP);
  const displayName = profile.displayName?.trim() ?? "";

  const members = await db
    .select({
      memberId: householdMembers.id,
      userId: householdMembers.userId,
      legacyDisplayName: householdMembers.legacyDisplayName,
      userEmail: users.email,
    })
    .from(householdMembers)
    .innerJoin(users, eq(householdMembers.userId, users.id))
    .where(eq(householdMembers.householdId, householdId));

  let target = members.find((m) => emailMap.get(m.legacyDisplayName?.toLowerCase() ?? "") === email);
  if (!target && displayName) {
    target = members.find(
      (m) => m.legacyDisplayName?.toLowerCase() === displayName.toLowerCase(),
    );
  }
  if (!target) return null;

  if (!isPlaceholderEmail(target.userEmail)) {
    throw new HouseholdClaimError("already_claimed");
  }

  if (existingUser && existingUser.id !== target.userId) {
    await db
      .update(householdMembers)
      .set({ userId: existingUser.id })
      .where(eq(householdMembers.id, target.memberId));
    await db.delete(users).where(eq(users.id, target.userId));
    await ensureOwnerIfNone(db, householdId, target.memberId);
    return { userId: existingUser.id, householdId };
  }

  await db
    .update(users)
    .set({
      email,
      displayName: profile.displayName ?? target.legacyDisplayName,
      imageUrl: profile.imageUrl,
      emailVerified: profile.emailVerified ?? true,
      updatedAt: new Date(),
    })
    .where(eq(users.id, target.userId));

  await ensureOwnerIfNone(db, householdId, target.memberId);
  return { userId: target.userId, householdId };
}

export async function resolveLoginUserAndHousehold(
  db: Database,
  env: Env,
  profile: { email: string; displayName?: string; imageUrl?: string; emailVerified?: boolean },
): Promise<{ userId: string; householdId: string }> {
  if (await hasImportRecords(db)) {
    const claimed = await tryClaimImportedMember(db, env, profile);
    if (!claimed) throw new HouseholdClaimError("no_household");
    return claimed;
  }
  const user = await findOrCreateUser(db, profile);
  const householdId = await bootstrapHouseholdOnLogin(db, env, user.id);
  return { userId: user.id, householdId };
}
