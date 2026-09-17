import type { Database } from "@domi-ops/db";
import { baAccounts, baSessions, householdMembers, households, users } from "@domi-ops/db";
import { and, eq, inArray, sql } from "drizzle-orm";

export type UserDetails = {
  id: string;
  email: string | null;
  username: string | null;
  displayName: string | null;
  createdAt: Date;
  householdId: string | null;
  householdName: string | null;
  role: string | null;
  accountProviders: string[];
  sessionCount: number;
  isOrphaned: boolean;
};

/** List all users in the database with their household membership status and auth info. */
export async function listAllUsers(db: Database): Promise<UserDetails[]> {
  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      createdAt: users.createdAt,
      householdId: householdMembers.householdId,
      role: householdMembers.role,
      householdName: households.name,
    })
    .from(users)
    .leftJoin(householdMembers, eq(householdMembers.userId, users.id))
    .leftJoin(households, eq(households.id, householdMembers.householdId));

  const accounts = await db
    .select({ userId: baAccounts.userId, providerId: baAccounts.providerId })
    .from(baAccounts);

  const sessions = await db
    .select({
      userId: baSessions.userId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(baSessions)
    .groupBy(baSessions.userId);

  const providerMap = new Map<string, string[]>();
  for (const acc of accounts) {
    const list = providerMap.get(acc.userId) ?? [];
    if (!list.includes(acc.providerId)) list.push(acc.providerId);
    providerMap.set(acc.userId, list);
  }

  const sessionMap = new Map<string, number>();
  for (const s of sessions) {
    sessionMap.set(s.userId, Number(s.count));
  }

  return userRows.map((u) => ({
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.displayName,
    createdAt: u.createdAt,
    householdId: u.householdId,
    householdName: u.householdName,
    role: u.role,
    accountProviders: providerMap.get(u.id) ?? [],
    sessionCount: sessionMap.get(u.id) ?? 0,
    isOrphaned: !u.householdId,
  }));
}

/** Get details for a specific user by email or username or ID. */
export async function findUser(
  db: Database,
  query: { email?: string; username?: string; id?: string },
): Promise<UserDetails | null> {
  const all = await listAllUsers(db);
  if (query.id) {
    return all.find((u) => u.id === query.id) ?? null;
  }
  if (query.email) {
    const normalized = query.email.trim().toLowerCase();
    return all.find((u) => u.email?.toLowerCase() === normalized) ?? null;
  }
  if (query.username) {
    const normalized = query.username.trim().toLowerCase();
    return all.find((u) => u.username?.toLowerCase() === normalized) ?? null;
  }
  return null;
}

/** Delete a user and cascade-delete sessions, accounts, and memberships. */
export async function deleteUser(
  db: Database,
  userId: string,
): Promise<{ deleted: boolean; email: string | null; username: string | null }> {
  const [user] = await db
    .select({ id: users.id, email: users.email, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return { deleted: false, email: null, username: null };
  }

  // Delete associated sessions, accounts, household_members (and user row)
  await db.delete(baSessions).where(eq(baSessions.userId, userId));
  await db.delete(baAccounts).where(eq(baAccounts.userId, userId));
  await db.delete(householdMembers).where(eq(householdMembers.userId, userId));
  await db.delete(users).where(eq(users.id, userId));

  return { deleted: true, email: user.email, username: user.username };
}

/** Delete all orphaned users (users who are not attached to any household). */
export async function deleteOrphanedUsers(
  db: Database,
): Promise<Array<{ id: string; email: string | null; username: string | null }>> {
  const all = await listAllUsers(db);
  const orphans = all.filter((u) => u.isOrphaned);
  const deletedList: Array<{ id: string; email: string | null; username: string | null }> = [];

  for (const orphan of orphans) {
    const res = await deleteUser(db, orphan.id);
    if (res.deleted) {
      deletedList.push({ id: orphan.id, email: res.email, username: res.username });
    }
  }

  return deletedList;
}

/** Attach an orphaned user to an existing household. */
export async function attachUserToHousehold(
  db: Database,
  userId: string,
  householdId: string,
  role: "owner" | "admin" | "member" | "child" | "guest" = "member",
): Promise<{ attached: boolean; householdName: string | null }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error(`User ${userId} not found`);

  const [household] = await db.select().from(households).where(eq(households.id, householdId)).limit(1);
  if (!household) throw new Error(`Household ${householdId} not found`);

  const [existing] = await db
    .select()
    .from(householdMembers)
    .where(and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId)))
    .limit(1);

  if (existing) {
    return { attached: true, householdName: household.name };
  }

  await db.insert(householdMembers).values({
    householdId,
    userId,
    role,
    name: user.displayName ?? user.email?.split("@")[0] ?? "Member",
  });

  return { attached: true, householdName: household.name };
}
