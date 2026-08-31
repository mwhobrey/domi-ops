import type { Database } from "../client.js";
import { baAccounts, householdMembers, households, users } from "../schema/index.js";
import { hashPassword } from "better-auth/crypto";
import { createLocalAccountIssuer } from "better-auth/db";
import { eq, inArray, or } from "drizzle-orm";
import {
  DEMO_MEMBER_PASSWORD_DEFAULT,
  DEMO_MEMBERS,
  DEMO_OWNER_EMAIL,
  DEMO_SLUG,
  type DemoMemberSpec,
} from "./constants.js";
import { homeStatus } from "../schema/core.js";

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export async function wipeDemoHousehold(db: Database): Promise<void> {
  const userIds = new Set<string>();

  const [household] = await db
    .select({ id: households.id })
    .from(households)
    .where(eq(households.slug, DEMO_SLUG))
    .limit(1);

  if (household) {
    const members = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, household.id));
    for (const m of members) userIds.add(m.userId);
    await db.delete(households).where(eq(households.id, household.id));
  }

  const ownerEmail = (process.env.DEMO_OWNER_EMAIL ?? DEMO_OWNER_EMAIL).toLowerCase();
  const usernames = DEMO_MEMBERS.map((m) => m.username).filter(Boolean) as string[];
  const usernameFilters = usernames.map((u) => eq(users.username, normalizeUsername(u)));
  const orphanUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(
      usernameFilters.length > 0
        ? or(eq(users.email, ownerEmail), ...usernameFilters)
        : eq(users.email, ownerEmail),
    );
  for (const u of orphanUsers) userIds.add(u.id);

  if (userIds.size > 0) {
    await db.delete(users).where(inArray(users.id, [...userIds]));
  }
}

async function createCredentialUser(
  db: Database,
  spec: DemoMemberSpec,
  householdId: string,
  password: string,
  emailOverride?: string,
): Promise<{ userId: string; memberId: string }> {
  const passwordHash = await hashPassword(password);
  const email = emailOverride?.toLowerCase() ?? spec.email?.toLowerCase() ?? null;
  const normalizedUsername = spec.username ? normalizeUsername(spec.username) : null;

  const [createdUser] = await db
    .insert(users)
    .values({
      email,
      username: normalizedUsername,
      displayUsername: spec.username ?? null,
      displayName: spec.displayName,
      emailVerified: email ? true : false,
    })
    .returning({ id: users.id });

  await db.insert(baAccounts).values({
    userId: createdUser.id,
    providerId: "credential",
    // Better Auth's credential sign-in match requires BOTH accountId === user.id AND issuer ===
    // createLocalAccountIssuer(providerId) (see node_modules/better-auth/dist/api/routes/sign-in.mjs
    // + internal-adapter.mjs). Neither was set here before - the row looked completely correct
    // (user + credential account present, password hash verified fine in isolation) but Better
    // Auth's own account match never found it, so every login attempt logged "User not found"
    // and returned 401 regardless of password. Confirmed live + fixed 2026-08-31, WHO-250.
    accountId: createdUser.id,
    issuer: createLocalAccountIssuer("credential"),
    password: passwordHash,
  });

  const [member] = await db
    .insert(householdMembers)
    .values({
      householdId,
      userId: createdUser.id,
      role: spec.role,
      name: spec.displayName,
    })
    .returning({ id: householdMembers.id });

  await db.insert(homeStatus).values({
    householdId,
    memberId: member.id,
    name: spec.displayName.slice(0, 64),
    presence: spec.presence,
  });

  return { userId: createdUser.id, memberId: member.id };
}

export type DemoSeedContext = {
  householdId: string;
  members: Record<
    DemoMemberSpec["key"],
    { userId: string; memberId: string }
  >;
  ownerUserId: string;
};

export async function createDemoMembers(
  db: Database,
  householdId: string,
  password: string,
): Promise<DemoSeedContext> {
  const members = {} as DemoSeedContext["members"];
  let ownerUserId = "";

  for (const spec of DEMO_MEMBERS) {
    const emailOverride =
      spec.key === "maria"
        ? (process.env.DEMO_OWNER_EMAIL ?? DEMO_OWNER_EMAIL).toLowerCase()
        : undefined;
    const created = await createCredentialUser(
      db,
      spec,
      householdId,
      password,
      emailOverride,
    );
    members[spec.key] = created;
    if (spec.role === "owner") ownerUserId = created.userId;
  }

  return { householdId, members, ownerUserId };
}
