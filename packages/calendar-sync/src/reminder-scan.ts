import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { calendarEventReminders, calendarEvents } from "@whome/db";
import { and, eq, isNull } from "drizzle-orm";
import { notifyHouseholdOfCalendarReminder } from "./push-calendar.js";

export async function scanCalendarReminders(db: Database, env: Env): Promise<number> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 6 * 60 * 1000);

  const rows = await db
    .select({
      reminderId: calendarEventReminders.id,
      offsetMinutes: calendarEventReminders.offsetMinutes,
      lastSentAt: calendarEventReminders.lastSentAt,
      eventId: calendarEvents.id,
      householdId: calendarEvents.householdId,
      title: calendarEvents.title,
      startDate: calendarEvents.startDate,
      startTime: calendarEvents.startTime,
      allDay: calendarEvents.allDay,
    })
    .from(calendarEventReminders)
    .innerJoin(calendarEvents, eq(calendarEventReminders.eventId, calendarEvents.id))
    .where(
      and(
        eq(calendarEventReminders.enabled, true),
        isNull(calendarEventReminders.lastSentAt),
      ),
    );

  let sent = 0;
  for (const row of rows) {
    const start = row.allDay || !row.startTime
      ? new Date(`${row.startDate}T09:00:00`)
      : new Date(`${row.startDate}T${row.startTime}`);
    const fireAt = new Date(start.getTime() - row.offsetMinutes * 60 * 1000);
    if (fireAt < now || fireAt > windowEnd) continue;

    const startsInMinutes = Math.max(
      1,
      Math.round((start.getTime() - now.getTime()) / 60000),
    );

    await notifyHouseholdOfCalendarReminder(db, env, {
      householdId: row.householdId,
      eventId: row.eventId,
      title: row.title,
      startsInMinutes,
    });

    await db
      .update(calendarEventReminders)
      .set({ lastSentAt: now })
      .where(eq(calendarEventReminders.id, row.reminderId));
    sent += 1;
  }
  return sent;
}
