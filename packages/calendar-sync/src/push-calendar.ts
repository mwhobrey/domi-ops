import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { users } from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";
import { calendarReminderRecipientUserIds } from "./calendar-recipients.js";
import { deliverUserNotification } from "./user-notify.js";

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** "Munch starts in 3 hours", "… in 1 hour 30 minutes", "… in 20 minutes", "… tomorrow". */
export function calendarReminderBody(title: string, startsInMinutes: number): string {
  if (startsInMinutes >= 1440) return `${title} starts tomorrow`;
  if (startsInMinutes >= 60) {
    const hours = Math.floor(startsInMinutes / 60);
    const minutes = startsInMinutes % 60;
    return `${title} starts in ${plural(hours, "hour")}${minutes ? ` ${plural(minutes, "minute")}` : ""}`;
  }
  return `${title} starts in ${plural(Math.max(0, startsInMinutes), "minute")}`;
}

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

  const body = calendarReminderBody(input.title, input.startsInMinutes);

  await deliverUserNotification(db, env, {
    userIds: enabledIds,
    householdId: input.householdId,
    title: "Calendar reminder",
    body,
    url: `/calendar?event=${input.eventId}`,
    tag: `calendar-${input.eventId}`,
  });
}
