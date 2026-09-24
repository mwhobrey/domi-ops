import type { Database } from "@domi-ops/db";
import { calendarEvents } from "@domi-ops/db";
import { and, asc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { computeEventPolicy, loadEventPolicyContext } from "./calendar-event-policy.js";
import type { CalendarListEvent } from "./calendar-event-policy.js";
import { enrichEventDto } from "./calendar-event-enrich.js";
import { listVisibleCalendars } from "./calendar-lanes.js";

/**
 * Native (non-overlay) calendar_events rows visible to the user within [from, to],
 * enriched with policy/category/reminder data. Shared by GET /events and the
 * schedule-conflicts checker so the two never drift.
 */
export async function listNativeCalendarEvents(
  db: Database,
  auth: { householdId: string; userId: string },
  from: string,
  to: string,
  opts?: { q?: string },
): Promise<CalendarListEvent[]> {
  const visible = await listVisibleCalendars(db, auth.householdId, auth.userId);
  const visibleIds = visible.map((cal) => cal.id);
  if (visibleIds.length === 0) return [];

  const conditions = [
    eq(calendarEvents.householdId, auth.householdId),
    inArray(calendarEvents.calendarId, visibleIds),
    lte(calendarEvents.startDate, to),
    gte(sql`COALESCE(${calendarEvents.endDate}, ${calendarEvents.startDate})`, from),
  ];
  if (opts?.q) conditions.push(ilike(calendarEvents.title, `%${opts.q}%`));

  const rows = await db
    .select()
    .from(calendarEvents)
    .where(and(...conditions))
    .orderBy(asc(calendarEvents.startDate), asc(calendarEvents.startTime));

  const policyCtx = await loadEventPolicyContext(db, auth.householdId, auth.userId);
  const enriched = await Promise.all(
    rows.map((row) =>
      enrichEventDto(db, auth.householdId, row, computeEventPolicy(row, policyCtx)),
    ),
  );

  return enriched.map((e) => ({
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    description: e.description,
    categoryKey: e.categoryKey,
    categoryLabel: e.categoryLabel,
    color: e.color,
    startDate: e.startDate,
    endDate: e.endDate,
    startTime: e.startTime,
    endTime: e.endTime,
    timeZone: e.timeZone,
    allDay: e.allDay,
    location: e.location,
    attendeeMemberIds: e.attendeeMemberIds,
    driveBufferBeforeMinutes: e.driveBufferBeforeMinutes,
    driveBufferAfterMinutes: e.driveBufferAfterMinutes,
    source: e.source,
    syncStatus: e.syncStatus,
    googleEventId: e.googleEventId,
    recurringRuleId: e.recurringRuleId,
    editable: e.editable,
    pushable: e.pushable,
    reminderOffsets: e.reminderOffsets,
  }));
}
