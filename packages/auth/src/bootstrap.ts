import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import {
  householdMembers,
  households,
  users,
} from "@whome/db";
import { eq } from "drizzle-orm";
import { hasImportRecords } from "./import-records.js";

export interface AuthContext {
  userId: string;
  householdId: string;
  memberId: string;
  email: string | null;
  username: string | null;
  name: string | null;
  nickname: string | null;
  publicLabel: "name" | "nickname";
  role: "owner" | "admin" | "member" | "child" | "guest";
}

export async function bootstrapHouseholdOnLogin(
  db: Database,
  env: Env,
  userId: string,
  householdName?: string,
): Promise<string> {
  const [existing] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  if (existing) return existing.householdId;

  if (await hasImportRecords(db)) {
    throw new Error("Imported household exists; sign in to join it");
  }

  if (env.DEPLOYMENT_MODE !== "single") {
    throw new Error("User has no household; contact admin (non-single deployment)");
  }

  const [household] = await db
    .insert(households)
    .values({
      name: householdName ?? "Our Household",
      tier: "self_host",
      modulesEnabled: JSON.stringify(env.MODULES_ENABLED),
      timezone: "America/Chicago",
    })
    .returning();

  await db.insert(householdMembers).values({
    householdId: household.id,
    userId,
    role: "owner",
  });

  return household.id;
}

export async function resolveAuthContext(
  db: Database,
  userId: string,
): Promise<AuthContext | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const [member] = await db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  if (!member) return null;

  return {
    userId: user.id,
    householdId: member.householdId,
    memberId: member.id,
    email: user.email,
    username: user.username,
    name: member.name,
    nickname: member.nickname,
    publicLabel: member.publicLabel,
    role: member.role,
  };
}

export async function findOrCreateUser(
  db: Database,
  profile: { email: string; displayName?: string; imageUrl?: string; emailVerified?: boolean },
): Promise<{ id: string }> {
  const email = profile.email.toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    await db
      .update(users)
      .set({
        displayName: profile.displayName ?? existing.displayName,
        imageUrl: profile.imageUrl ?? existing.imageUrl,
        emailVerified: profile.emailVerified ?? existing.emailVerified,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
    return { id: existing.id };
  }
  const [created] = await db
    .insert(users)
    .values({
      email,
      displayName: profile.displayName,
      imageUrl: profile.imageUrl,
      emailVerified: profile.emailVerified ?? true,
    })
    .returning({ id: users.id });
  return created;
}
