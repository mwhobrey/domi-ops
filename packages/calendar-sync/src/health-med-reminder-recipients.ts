import { memberShownLabel } from "@domi-ops/auth";
import type { Database } from "@domi-ops/db";
import { healthMemberAcl, householdMembers, users } from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";

export type HealthMedReminderRecipient = {
  userId: string;
  memberId: string;
  isSubject: boolean;
};

export type HealthMedReminderRecipientBundle = {
  recipients: HealthMedReminderRecipient[];
  subjectLabel: string;
};

/**
 * Pure merge/filter for subject + dose-write grantees (WHO-238).
 * Only users in `pushEnabledUserIds` are returned.
 */
export function mergeHealthMedReminderRecipients(input: {
  subject: { memberId: string; userId: string | null; name: string | null };
  doseWriters: { memberId: string; userId: string | null }[];
  pushEnabledUserIds: ReadonlySet<string>;
}): HealthMedReminderRecipientBundle {
  const subjectLabel = memberShownLabel({ name: input.subject.name });
  const byUser = new Map<string, HealthMedReminderRecipient>();

  if (input.subject.userId && input.pushEnabledUserIds.has(input.subject.userId)) {
    byUser.set(input.subject.userId, {
      userId: input.subject.userId,
      memberId: input.subject.memberId,
      isSubject: true,
    });
  }

  for (const writer of input.doseWriters) {
    if (!writer.userId || !input.pushEnabledUserIds.has(writer.userId)) continue;
    if (byUser.has(writer.userId)) continue;
    byUser.set(writer.userId, {
      userId: writer.userId,
      memberId: writer.memberId,
      isSubject: writer.memberId === input.subject.memberId,
    });
  }

  return { recipients: [...byUser.values()], subjectLabel };
}

/** Subject + ACL `doses: write` grantees with health med push enabled. */
export async function listHealthMedReminderRecipients(
  db: Database,
  input: { householdId: string; subjectMemberId: string },
): Promise<HealthMedReminderRecipientBundle> {
  const [subject] = await db
    .select({
      memberId: householdMembers.id,
      userId: householdMembers.userId,
      name: householdMembers.name,
    })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.id, input.subjectMemberId),
        eq(householdMembers.householdId, input.householdId),
      ),
    )
    .limit(1);

  if (!subject) {
    return { recipients: [], subjectLabel: "Member" };
  }

  const doseWriters = await db
    .select({
      memberId: householdMembers.id,
      userId: householdMembers.userId,
    })
    .from(healthMemberAcl)
    .innerJoin(householdMembers, eq(householdMembers.id, healthMemberAcl.granteeMemberId))
    .where(
      and(
        eq(healthMemberAcl.householdId, input.householdId),
        eq(healthMemberAcl.subjectMemberId, input.subjectMemberId),
        eq(healthMemberAcl.dosesAccess, "write"),
      ),
    );

  const candidateUserIds = [
    ...new Set(
      [subject.userId, ...doseWriters.map((w) => w.userId)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];

  const pushEnabledUserIds = new Set<string>();
  if (candidateUserIds.length > 0) {
    const enabled = await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, candidateUserIds), eq(users.pushHealthRemindersEnabled, true)));
    for (const row of enabled) pushEnabledUserIds.add(row.id);
  }

  return mergeHealthMedReminderRecipients({
    subject,
    doseWriters,
    pushEnabledUserIds,
  });
}
