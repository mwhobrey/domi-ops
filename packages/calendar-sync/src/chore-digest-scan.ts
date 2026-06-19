import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { chores, householdMembers, households, users } from "@whome/db";
import { and, eq } from "drizzle-orm";
import { deliverUserNotification } from "./user-notify.js";
import { localHourInTz, todayIsoDateInTz } from "./household-time.js";

/** Local hour when the due-today chore digest fires (complements per-item tomorrow/overdue). */
export const CHORE_DIGEST_HOUR = 8;

function digestBody(descriptions: string[]): string {
  if (descriptions.length === 1) return descriptions[0]!;
  const preview = descriptions.slice(0, 3).join(", ");
  const extra = descriptions.length - 3;
  return extra > 0 ? `${preview} +${extra} more` : preview;
}

export async function scanChoreDigest(db: Database, env: Env): Promise<number> {
  const now = new Date();
  const householdRows = await db
    .select({ id: households.id, timezone: households.timezone })
    .from(households);

  let sent = 0;

  for (const household of householdRows) {
    const tz = household.timezone || "UTC";
    if (localHourInTz(now, tz) < CHORE_DIGEST_HOUR) continue;

    const today = todayIsoDateInTz(tz);
    const members = await db
      .select({
        userId: householdMembers.userId,
        memberId: householdMembers.id,
        choreDigestSentOn: users.choreDigestSentOn,
        pushEnabled: users.pushChoresRemindersEnabled,
      })
      .from(householdMembers)
      .innerJoin(users, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.householdId, household.id));

    const dueToday = await db
      .select({
        description: chores.description,
        assigneeMemberId: chores.assigneeMemberId,
      })
      .from(chores)
      .where(
        and(
          eq(chores.householdId, household.id),
          eq(chores.done, false),
          eq(chores.dueDate, today),
        ),
      );

    if (dueToday.length === 0) continue;

    const choresByUser = new Map<string, string[]>();
    const memberUserById = new Map(members.map((m) => [m.memberId, m.userId]));
    const allUserIds = members.map((m) => m.userId);

    for (const chore of dueToday) {
      if (chore.assigneeMemberId) {
        const userId = memberUserById.get(chore.assigneeMemberId);
        if (!userId) continue;
        const list = choresByUser.get(userId) ?? [];
        list.push(chore.description);
        choresByUser.set(userId, list);
      } else {
        for (const userId of allUserIds) {
          const list = choresByUser.get(userId) ?? [];
          list.push(chore.description);
          choresByUser.set(userId, list);
        }
      }
    }

    for (const member of members) {
      if (!member.pushEnabled) continue;
      if (member.choreDigestSentOn === today) continue;

      const descriptions = choresByUser.get(member.userId);
      if (!descriptions || descriptions.length === 0) continue;

      const count = descriptions.length;
      await deliverUserNotification(db, env, {
        userIds: [member.userId],
        householdId: household.id,
        title: count === 1 ? "1 chore due today" : `${count} chores due today`,
        body: digestBody(descriptions),
        url: "/chores",
        tag: `chore-digest-${member.userId}-${today}`,
      });

      await db
        .update(users)
        .set({ choreDigestSentOn: today })
        .where(eq(users.id, member.userId));
      sent += 1;
    }
  }

  return sent;
}
