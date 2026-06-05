import { hashPassword } from "better-auth/crypto";
import type { Database } from "@whome/db";
import { baAccounts, homeStatus, householdMembers, users } from "@whome/db";
import { eq } from "drizzle-orm";
import { memberShownLabel } from "./member-label.js";
import { normalizeUsername, validateUsernameFormat } from "./username.js";

export type ProvisionMemberRole = "child" | "member" | "guest";

export type ProvisionUsernameMemberInput = {
  householdId: string;
  username: string;
  displayName: string;
  password: string;
  role: ProvisionMemberRole;
  nickname?: string | null;
};

export type ProvisionUsernameMemberResult = {
  userId: string;
  memberId: string;
  username: string;
};

/** Create a username-only household member (no email). Parent must call after auth check. */
export async function provisionUsernameMember(
  db: Database,
  input: ProvisionUsernameMemberInput,
): Promise<ProvisionUsernameMemberResult> {
  const formatError = validateUsernameFormat(input.username);
  if (formatError) {
    throw new ProvisionMemberError(formatError, "invalid_username");
  }
  if (input.password.length < 8) {
    throw new ProvisionMemberError("Password must be at least 8 characters", "invalid_password");
  }

  const normalized = normalizeUsername(input.username);
  const displayUsername = input.username.trim();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, normalized))
    .limit(1);
  if (existing) {
    throw new ProvisionMemberError("Username is already taken", "username_taken");
  }

  const passwordHash = await hashPassword(input.password);
  const displayName = input.displayName.trim().slice(0, 128) || displayUsername;

  const [createdUser] = await db
    .insert(users)
    .values({
      email: null,
      username: normalized,
      displayUsername,
      displayName,
      emailVerified: false,
    })
    .returning({ id: users.id });

  await db.insert(baAccounts).values({
    userId: createdUser.id,
    providerId: "credential",
    accountId: createdUser.id,
    password: passwordHash,
  });

  const [member] = await db
    .insert(householdMembers)
    .values({
      householdId: input.householdId,
      userId: createdUser.id,
      role: input.role,
      name: displayName,
      nickname: input.nickname?.trim().slice(0, 64) ?? null,
      publicLabel: "name",
    })
    .returning({
      id: householdMembers.id,
      name: householdMembers.name,
      nickname: householdMembers.nickname,
      publicLabel: householdMembers.publicLabel,
    });

  await db.insert(homeStatus).values({
    householdId: input.householdId,
    memberId: member.id,
    name: memberShownLabel(member).slice(0, 64),
    presence: "Away",
  });

  return {
    userId: createdUser.id,
    memberId: member.id,
    username: normalized,
  };
}

export class ProvisionMemberError extends Error {
  code: "invalid_username" | "invalid_password" | "username_taken";

  constructor(message: string, code: ProvisionMemberError["code"]) {
    super(message);
    this.name = "ProvisionMemberError";
    this.code = code;
  }
}

export async function isUsernameAvailable(db: Database, username: string): Promise<boolean> {
  const formatError = validateUsernameFormat(username);
  if (formatError) return false;
  const normalized = normalizeUsername(username);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, normalized))
    .limit(1);
  return !existing;
}

export async function listHouseholdMembersWithAuth(
  db: Database,
  householdId: string,
): Promise<
  Array<{
    memberId: string;
    role: string;
    name: string | null;
    nickname: string | null;
    username: string | null;
    email: string | null;
  }>
> {
  const rows = await db
    .select({
      memberId: householdMembers.id,
      role: householdMembers.role,
      name: householdMembers.name,
      nickname: householdMembers.nickname,
      username: users.username,
      email: users.email,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, householdId));

  return rows;
}

export function canProvisionMembers(role: string): boolean {
  return role === "owner" || role === "admin";
}
