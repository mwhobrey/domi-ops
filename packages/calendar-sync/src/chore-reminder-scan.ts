import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { chores, householdMembers, households, users } from "@whome/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { classifyDueReminder, todayIsoDateInTz, type DueReminderKind } from "./household-time.js";
import { deliverUserNotification } from "./user-notify.js";

function choreReminderCopy(description: string, kind: DueReminderKind): { title: string; body: string } {
  switch (kind) {
    case "due_tomorrow":
      return {
        title: "Chore due tomorrow",
        body: `"${description}" is due tomorrow`,
      };
    case "due_today":
      return {
        title: "Chore due today",
        body: `"${description}" is due today`,
      };
    case "overdue":
      return {
        title: "Redemption quest",
        body: `"${description}" is ready for a redemption quest — you've got this!`,
      };
  }
}

async function notifyChoreReminder(
  db: Database,
  env: Env,
  input: {
    choreId: string;
    householdId: string;
    description: string;
    assigneeMemberId: string | null;
    kind: DueReminderKind;
  },
): Promise<void> {
  let recipientUserIds: string[] = [];

  if (input.assigneeMemberId) {
    const [assignee] = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.id, input.assigneeMemberId),
          eq(householdMembers.householdId, input.householdId),
        ),
      )
      .limit(1);
    if (assignee) recipientUserIds = [assignee.userId];
  } else {
    const members = await db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, input.householdId));
    recipientUserIds = members.map((m) => m.userId);
  }

  if (recipientUserIds.length === 0) return;

  const enabled = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, recipientUserIds),
        eq(users.pushChoresRemindersEnabled, true),
      ),
    );
  const enabledIds = enabled.map((u) => u.id);
  if (enabledIds.length === 0) return;

  const copy = choreReminderCopy(input.description, input.kind);
  await deliverUserNotification(db, env, {
    userIds: enabledIds,
    householdId: input.householdId,
    title: copy.title,
    body: copy.body,
    url: "/chores",
    tag: `chore-${input.choreId}-${input.kind}`,
  });
}

export async function scanChoreReminders(db: Database, env: Env): Promise<number> {
  const now = new Date();
  const rows = await db
    .select({
      id: chores.id,
      householdId: chores.householdId,
      description: chores.description,
      dueDate: chores.dueDate,
      assigneeMemberId: chores.assigneeMemberId,
      dueReminderSentAt: chores.dueReminderSentAt,
      timezone: households.timezone,
    })
    .from(chores)
    .innerJoin(households, eq(chores.householdId, households.id))
    .where(and(eq(chores.done, false), isNotNull(chores.dueDate)));

  let sent = 0;

  for (const row of rows) {
    if (!row.dueDate) continue;
    const today = todayIsoDateInTz(row.timezone);
    const kind = classifyDueReminder({
      dueDate: row.dueDate,
      today,
      lastSentAt: row.dueReminderSentAt,
      now,
      timeZone: row.timezone,
    });
    // due_today is covered by the morning digest (chore.digest.scan)
    if (!kind || kind === "due_today") continue;

    await notifyChoreReminder(db, env, {
      choreId: row.id,
      householdId: row.householdId,
      description: row.description,
      assigneeMemberId: row.assigneeMemberId,
      kind,
    });

    await db
      .update(chores)
      .set({ dueReminderSentAt: now })
      .where(eq(chores.id, row.id));
    sent += 1;
  }

  return sent;
}
