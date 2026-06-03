import type { createDb } from "@whome/db";
import { householdMembers } from "@whome/db";
import { and, eq } from "drizzle-orm";

type Db = ReturnType<typeof createDb>;

/** Map HomeHub display name (teacher_id / student_id) to household_members.id */
export async function resolveMemberId(
  db: Db,
  householdId: string,
  displayName: string,
  cache: Map<string, string>,
): Promise<string | null> {
  const key = displayName.trim().toLowerCase();
  if (!key) return null;
  const cached = cache.get(key);
  if (cached) return cached;

  const members = await db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId));

  for (const m of members) {
    const legacy = m.legacyDisplayName?.trim().toLowerCase();
    if (legacy && legacy === key) {
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
