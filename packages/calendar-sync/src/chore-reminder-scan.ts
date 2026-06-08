import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { chores, householdMembers, pushSubscriptions, users } from "@whome/db";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import webpush from "web-push";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function configured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

async function notifyChoreReminder(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    description: string;
    assigneeMemberId: string | null;
    kind: "due_today" | "overdue";
  },
): Promise<void> {
  if (!configured(env)) return;
  webpush.setVapidDetails(
    env.VAPID_SUBJECT!,
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );

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

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, enabledIds));

  const body =
    input.kind === "overdue"
      ? `"${input.description}" is ready for a redemption quest — you've got this!`
      : `"${input.description}" is due today`;

  const payload = JSON.stringify({
    title: input.kind === "overdue" ? "Redemption quest" : "Chore due today",
    body,
    url: "/chores",
  });

  await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.authKey } },
        payload,
      ),
    ),
  );
}

export async function scanChoreReminders(db: Database, env: Env): Promise<number> {
  const today = todayIsoDate();
  const rows = await db
    .select({
      id: chores.id,
      householdId: chores.householdId,
      description: chores.description,
      dueDate: chores.dueDate,
      assigneeMemberId: chores.assigneeMemberId,
    })
    .from(chores)
    .where(and(eq(chores.done, false), or(isNull(chores.dueReminderSentAt))));

  let sent = 0;
  const now = new Date();

  for (const row of rows) {
    if (!row.dueDate) continue;

    let kind: "due_today" | "overdue" | null = null;
    if (row.dueDate < today) {
      kind = "overdue";
    } else if (row.dueDate === today) {
      kind = "due_today";
    }
    if (!kind) continue;

    await notifyChoreReminder(db, env, {
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
