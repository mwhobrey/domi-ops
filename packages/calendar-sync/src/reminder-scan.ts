import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { calendarEventReminders, calendarEvents, households } from "@whome/db";
import { and, eq, isNull } from "drizzle-orm";
import { eventStartInstant } from "./household-time.js";
import { notifyHouseholdOfCalendarReminder } from "./push-calendar.js";

const LOOKBACK_MS = 30 * 60 * 1000;
const WINDOW_MS = 6 * 60 * 1000;

export async function scanCalendarReminders(db: Database, env: Env): Promise<number> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_MS);
  const lookbackStart = new Date(now.getTime() - LOOKBACK_MS);

  const rows = await db
    .select({
      reminderId: calendarEventReminders.id,
      offsetMinutes: calendarEventReminders.offsetMinutes,
      lastSentAt: calendarEventReminders.lastSentAt,
      eventId: calendarEvents.id,
      calendarId: calendarEvents.calendarId,
      householdId: calendarEvents.householdId,
      title: calendarEvents.title,
      startDate: calendarEvents.startDate,
      startTime: calendarEvents.startTime,
      allDay: calendarEvents.allDay,
      timeZone: calendarEvents.timeZone,
      householdTimezone: households.timezone,
    })
    .from(calendarEventReminders)
    .innerJoin(calendarEvents, eq(calendarEventReminders.eventId, calendarEvents.id))
    .innerJoin(households, eq(calendarEvents.householdId, households.id))
    .where(
      and(
        eq(calendarEventReminders.enabled, true),
        isNull(calendarEventReminders.lastSentAt),
      ),
    );

  let sent = 0;
  for (const row of rows) {
    const start = eventStartInstant(
      {
        startDate: row.startDate,
        startTime: row.startTime,
        allDay: row.allDay,
        timeZone: row.timeZone,
      },
      row.householdTimezone,
    );
    const fireAt = new Date(start.getTime() - row.offsetMinutes * 60 * 1000);
    if (fireAt > windowEnd) continue;
    if (fireAt < lookbackStart) continue;

    const startsInMinutes = Math.max(
      1,
      Math.round((start.getTime() - now.getTime()) / 60000),
    );

    await notifyHouseholdOfCalendarReminder(db, env, {
      householdId: row.householdId,
      calendarId: row.calendarId,
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
