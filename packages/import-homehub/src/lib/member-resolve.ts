import { slugLegacyName } from "@domi-ops/config";
import type { createDb } from "@domi-ops/db";
import { householdMembers, importRecords, users } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import type { DirectoryMember } from "./member-directory.js";
import { createStubMember } from "./stub-member.js";

type Db = ReturnType<typeof createDb>;

async function memberRows(db: Db, householdId: string) {
  return db
    .select({
      id: householdMembers.id,
      name: householdMembers.name,
      legacyDisplayName: householdMembers.legacyDisplayName,
      username: users.username,
    })
    .from(householdMembers)
    .innerJoin(users, eq(householdMembers.userId, users.id))
    .where(eq(householdMembers.householdId, householdId));
}

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

  const members = await memberRows(db, householdId);

  for (const m of members) {
    const keys = [
      m.name?.trim().toLowerCase(),
      m.legacyDisplayName?.trim().toLowerCase(),
      m.username?.trim().toLowerCase(),
    ].filter(Boolean) as string[];
    if (keys.includes(key)) {
      cache.set(key, m.id);
      return m.id;
    }
  }
  return null;
}

/** Create a claimable stub when SQLite references a student not in home_status (e.g. Riley). */
export async function resolveOrCreateSchoolStudent(
  db: Db,
  householdId: string,
  label: string,
  cache: Map<string, string>,
  directory?: DirectoryMember,
): Promise<{ memberId: string; created: boolean } | null> {
  const trimmed = label.trim();
  if (!trimmed) return null;

  const existing = await resolveMemberId(db, householdId, trimmed, cache);
  if (existing) return { memberId: existing, created: false };

  const sourceId = slugLegacyName(trimmed);
  const [prior] = await db
    .select({ targetId: importRecords.targetId })
    .from(importRecords)
    .where(
      and(
        eq(importRecords.householdId, householdId),
        eq(importRecords.sourceTable, "school_student_label"),
        eq(importRecords.sourceId, sourceId),
      ),
    )
    .limit(1);
  if (prior) {
    cache.set(trimmed.toLowerCase(), prior.targetId);
    return { memberId: prior.targetId, created: false };
  }

  const directoryEntry = directory ?? undefined;
  const created = await createStubMember(db, {
    householdId,
    legacyName: trimmed,
    role: directoryEntry?.role ?? "child",
    sourceTable: "school_student_label",
    sourceId,
    directory: directoryEntry,
  });

  cache.set(trimmed.toLowerCase(), created.memberId);
  return { memberId: created.memberId, created: true };
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
