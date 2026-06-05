import type { createDb } from "@whome/db";
import { householdMembers } from "@whome/db";
import { and, eq } from "drizzle-orm";

type Db = ReturnType<typeof createDb>;

/** Map school/HomeHub display name to household_members.id */
export async function resolveMemberId(
  db: Db,
  householdId: string,
  label: string,
  cache: Map<string, string>,
): Promise<string | null> {
  const key = label.trim().toLowerCase();
  if (!key) return null;
  const cached = cache.get(key);
  if (cached) return cached;

  const members = await db
    .select({
      id: householdMembers.id,
      name: householdMembers.name,
      legacyDisplayName: householdMembers.legacyDisplayName,
    })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));

  for (const m of members) {
    const keys = [
      m.name?.trim().toLowerCase(),
      m.legacyDisplayName?.trim().toLowerCase(),
    ].filter(Boolean) as string[];
    if (keys.includes(key)) {
      cache.set(key, m.id);
      return m.id;
    }
  }
  return null;
}

export async function defaultTeacherMemberId(db: Db, householdId: string): Promise<string | null> {
  const [owner] = await db
    .select()
    .from(householdMembers)
    .where(
      and(eq(householdMembers.householdId, householdId), eq(householdMembers.role, "owner")),
    )
    .limit(1);
  if (owner) return owner.id;
  const [any] = await db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .limit(1);
  return any?.id ?? null;
}
