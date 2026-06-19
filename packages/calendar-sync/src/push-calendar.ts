import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { users } from "@whome/db";
import { and, eq, inArray } from "drizzle-orm";
import { calendarReminderRecipientUserIds } from "./calendar-recipients.js";
import { deliverUserNotification } from "./user-notify.js";

export async function notifyHouseholdOfCalendarReminder(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    calendarId: string;
    eventId: string;
    title: string;
    startsInMinutes: number;
  },
): Promise<void> {
  const recipientIds = await calendarReminderRecipientUserIds(
    db,
    input.calendarId,
    input.householdId,
  );
  if (recipientIds.length === 0) return;

  const enabled = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, recipientIds),
        eq(users.pushCalendarRemindersEnabled, true),
      ),
    );
  const enabledIds = enabled.map((u) => u.id);
  if (enabledIds.length === 0) return;

  const body =
    input.startsInMinutes >= 1440
      ? `${input.title} starts tomorrow`
      : input.startsInMinutes >= 60
        ? `${input.title} starts in ${Math.round(input.startsInMinutes / 60)} hour(s)`
        : `${input.title} starts in ${input.startsInMinutes} minutes`;

  await deliverUserNotification(db, env, {
    userIds: enabledIds,
    householdId: input.householdId,
    title: "Calendar reminder",
    body,
    url: `/calendar?event=${input.eventId}`,
    tag: `calendar-${input.eventId}`,
  });
}
