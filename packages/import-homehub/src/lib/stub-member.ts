import { importedStubEmail } from "@whome/config";
import type { createDb } from "@whome/db";
import { homeStatus, householdMembers, importRecords, users } from "@whome/db";
import { and, eq } from "drizzle-orm";
import type { DirectoryMember, StubRole } from "./member-directory.js";

type Db = ReturnType<typeof createDb>;

export function primaryClaimEmail(entry: DirectoryMember | undefined): string | null {
  if (!entry || entry.claimEmails.size === 0) return null;
  return [...entry.claimEmails][0] ?? null;
}

export async function syncStubClaimEmails(
  db: Db,
  householdId: string,
  memberId: string,
  userId: string,
  claimEmails: Iterable<string>,
): Promise<void> {
  const emails = [...new Set([...claimEmails].map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const primary = emails[0] ?? null;

  await db
    .update(users)
    .set({ importClaimEmail: primary })
    .where(eq(users.id, userId));

  for (const email of emails) {
    const [existing] = await db
      .select({ id: importRecords.id })
      .from(importRecords)
      .where(
        and(
          eq(importRecords.householdId, householdId),
          eq(importRecords.sourceTable, "homehub_claim_email"),
          eq(importRecords.sourceId, email),
        ),
      )
      .limit(1);
    if (existing) {
      await db
        .update(importRecords)
        .set({ targetId: memberId })
        .where(eq(importRecords.id, existing.id));
      continue;
    }
    await db.insert(importRecords).values({
      householdId,
      sourceTable: "homehub_claim_email",
      sourceId: email,
      targetTable: "household_members",
      targetId: memberId,
    });
  }
}

export async function createStubMember(
  db: Db,
  input: {
    householdId: string;
    legacyName: string;
    role: StubRole;
    sourceTable: string;
    sourceId: string;
    directory?: DirectoryMember;
    presence?: "Home" | "Away";
  },
): Promise<{ memberId: string; userId: string }> {
  const legacyName = input.legacyName.trim();
  const stubEmail = importedStubEmail(legacyName, input.sourceId);

  const [stubUser] = await db
    .insert(users)
    .values({
      email: stubEmail,
      displayName: legacyName.slice(0, 128),
      emailVerified: false,
      importClaimEmail: primaryClaimEmail(input.directory),
    })
    .returning({ id: users.id });

  const [member] = await db
    .insert(householdMembers)
    .values({
      householdId: input.householdId,
      userId: stubUser.id,
      role: input.role,
      name: legacyName.slice(0, 128),
      legacyDisplayName: legacyName.slice(0, 64),
      legacyExternalId: input.sourceId,
    })
    .returning({ id: householdMembers.id });

  if (input.directory && input.directory.claimEmails.size > 0) {
    await syncStubClaimEmails(
      db,
      input.householdId,
      member.id,
      stubUser.id,
      input.directory.claimEmails,
    );
  }

  await ensureMemberHomeStatus(
    db,
    input.householdId,
    member.id,
    legacyName,
    input.presence ?? "Away",
  );

  await db.insert(importRecords).values({
    householdId: input.householdId,
    sourceTable: input.sourceTable,
    sourceId: input.sourceId,
    targetTable: "household_members",
    targetId: member.id,
  });

  return { memberId: member.id, userId: stubUser.id };
}

/** Who's-home board row — every household member should have one. */
export async function ensureMemberHomeStatus(
  db: Db,
  householdId: string,
  memberId: string,
  legacyName: string,
  presence: "Home" | "Away" = "Away",
): Promise<void> {
  const [existing] = await db
    .select({ id: homeStatus.id })
    .from(homeStatus)
    .where(
      and(eq(homeStatus.householdId, householdId), eq(homeStatus.memberId, memberId)),
    )
    .limit(1);
  if (existing) return;

  await db.insert(homeStatus).values({
    householdId,
    memberId,
    name: legacyName.slice(0, 64),
    presence,
  });
}
