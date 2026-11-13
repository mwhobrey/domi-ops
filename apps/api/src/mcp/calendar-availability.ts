import { z } from "zod";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { calendarEvents, households, mcpCalendarSelections, recurringRules, type Database } from "@domi-ops/db";
import { addDaysIso, localDateOfInstant, localTimeHhmm, occurrenceDates, parseRrule, todayIsoDateInTz, zonedLocalToUtc } from "@domi-ops/calendar-sync";
import { McpAuthorizationError, type McpOwnedConnection } from "@domi-ops/auth";
import { listVisibleCalendars } from "../lib/calendar-lanes.js";
import { McpGatewayError } from "./access.js";
import type { McpReadTool } from "./tools.js";

/**
 * Assistant access to calendar availability. The assistant learns when the member is busy on the
 * calendars they chose, as merged intervals. It never gets a title, description, location,
 * attendee, category, calendar name, event id or event count.
 *
 * Events imported from Google are left out and the response says so: sending availability derived
 * from Google user data to an AI provider needs its own policy review first.
 */
export const AVAILABILITY_LIMITS = { days: 14, intervals: 200, events: 2000, rules: 500, pastDays: 31, futureDays: 366 } as const;
export type BusySource = {
  startDate: string; endDate: string | null; startTime: string | null; endTime: string | null; allDay: boolean; timeZone: string | null;
  bufferBeforeMinutes?: number | null; bufferAfterMinutes?: number | null;
};
export type BusyInterval = { start: string; end: string; allDay: boolean };
type Viewer = { householdId: string; userId: string };

const MINUTE = 60_000;
const clock = (value: string) => value.slice(0, 5);
const buffer = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? Math.min(720, Math.max(0, Math.round(value))) : 0;
function zoneOr(value: string | null | undefined, fallback: string) {
  const zone = value?.trim();
  if (!zone) return fallback;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return zone; } catch { return fallback; }
}

/** One event as a half-open instant range. Drive buffers are folded in, so they cannot be told apart from the event. */
function span(event: BusySource, householdZone: string) {
  const last = event.endDate && event.endDate >= event.startDate ? event.endDate : event.startDate;
  if (event.allDay || !event.startTime) {
    return { start: zonedLocalToUtc(event.startDate, "00:00", householdZone).getTime(), end: zonedLocalToUtc(addDaysIso(last, 1), "00:00", householdZone).getTime(), allDay: true };
  }
  const zone = zoneOr(event.timeZone, householdZone);
  const start = zonedLocalToUtc(event.startDate, clock(event.startTime), zone).getTime();
  let end = event.endTime ? zonedLocalToUtc(last, clock(event.endTime), zone).getTime() : start + 60 * MINUTE;
  // An end at or before the start on the same date is an overnight event; anything else malformed counts as an hour.
  if (end <= start) end = event.endTime && last === event.startDate ? zonedLocalToUtc(addDaysIso(last, 1), clock(event.endTime), zone).getTime() : start + 60 * MINUTE;
  return { start: start - buffer(event.bufferBeforeMinutes) * MINUTE, end: end + buffer(event.bufferAfterMinutes) * MINUTE, allDay: false };
}

function merge(spans: { start: number; end: number }[]) {
  const merged: { start: number; end: number }[] = [];
  for (const current of [...spans].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged[merged.length - 1];
    // Touching events merge too: three back-to-back meetings read as one block.
    if (previous && current.start <= previous.end) previous.end = Math.max(previous.end, current.end);
    else merged.push({ ...current });
  }
  return merged;
}

/**
 * Busy time inside [from, to] in the household's timezone. Timed events merge with each other and
 * all-day events merge with each other, so a response never shows how many events made a block.
 */
export function busyIntervals(events: readonly BusySource[], from: string, to: string, householdZone: string, limit: number = AVAILABILITY_LIMITS.intervals) {
  const opens = zonedLocalToUtc(from, "00:00", householdZone).getTime(), closes = zonedLocalToUtc(addDaysIso(to, 1), "00:00", householdZone).getTime();
  const timed: { start: number; end: number }[] = [], days: { start: number; end: number }[] = [];
  for (const event of events) {
    const range = span(event, householdZone);
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) continue;
    const start = Math.max(range.start, opens), end = Math.min(range.end, closes);
    if (end > start) (range.allDay ? days : timed).push({ start, end });
  }
  const local = (instant: number) => localDateOfInstant(new Date(instant), householdZone) + "T" + localTimeHhmm(new Date(instant), householdZone);
  const all = [...merge(days).map((range) => ({ ...range, allDay: true })), ...merge(timed).map((range) => ({ ...range, allDay: false }))]
    .sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay));
  return { intervals: all.slice(0, limit).map((range): BusyInterval => ({ start: local(range.start), end: local(range.end), allDay: range.allDay })), truncated: all.length > limit };
}

export type RuleSource = {
  id: string; rrule: string; startDate: string; endDate: string | null; durationDays: number; startTime: string | null; endTime: string | null;
  allDay: boolean; timeZone: string | null; lastGeneratedDate: string | null;
};
/**
 * Occurrences of a repeating event that are not stored yet. Stored occurrences come from the events
 * table; a date at or before the rule's generated mark with no stored event was removed on purpose.
 */
export function pendingOccurrences(rule: RuleSource, from: string, to: string, stored: ReadonlySet<string>): BusySource[] {
  const parsed = parseRrule(rule.rrule);
  if (!parsed) return [];
  const generated = rule.lastGeneratedDate && rule.lastGeneratedDate > rule.startDate ? rule.lastGeneratedDate : null;
  const days = Math.min(31, Math.max(0, rule.durationDays));
  const first = addDaysIso(from, -days);
  const lower = generated && addDaysIso(generated, 1) > first ? addDaysIso(generated, 1) : first;
  return occurrenceDates(parsed, rule.startDate, lower, to, rule.endDate).filter((date) => !stored.has(rule.id + "|" + date)).map((date) => ({
    startDate: date, endDate: days > 0 ? addDaysIso(date, days) : null, startTime: rule.startTime, endTime: rule.endTime, allDay: rule.allDay, timeZone: rule.timeZone,
  }));
}

/** The member's own view of their calendars, for their browser only. Names are never sent to a provider. */
export async function listOwnCalendars(tx: Database, viewer: Viewer) {
  return (await listVisibleCalendars(tx, viewer.householdId, viewer.userId))
    .map((calendar) => ({ id: calendar.id, name: calendar.name, visibility: calendar.visibility }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Selected calendars the member can still see. A calendar unshared or archived later drops out on the next call. */
export async function selectedCalendarIds(tx: Database, viewer: Viewer, connectionId: string) {
  const rows = await tx.select({ calendarId: mcpCalendarSelections.calendarId }).from(mcpCalendarSelections)
    .where(and(eq(mcpCalendarSelections.connectionId, connectionId), eq(mcpCalendarSelections.householdId, viewer.householdId)));
  if (!rows.length) return [];
  const visible = new Set((await listVisibleCalendars(tx, viewer.householdId, viewer.userId)).map((calendar) => calendar.id));
  return rows.map((row) => row.calendarId).filter((id) => visible.has(id));
}

/** Calendars proposed in a form that has not been saved. Anything the member cannot see is refused, not dropped. */
export async function proposedCalendarIds(tx: Database, viewer: Viewer, ids: readonly string[]) {
  if (new Set(ids).size !== ids.length) throw new McpAuthorizationError("invalid_calendar_selection", 400);
  const visible = new Set((await listVisibleCalendars(tx, viewer.householdId, viewer.userId)).map((calendar) => calendar.id));
  if (ids.some((id) => !visible.has(id))) throw new McpAuthorizationError("invalid_calendar_selection", 400);
  return [...ids];
}

export async function viewCalendarSelections(tx: Database, connection: McpOwnedConnection) {
  return { calendars: await listOwnCalendars(tx, connection), calendarIds: await selectedCalendarIds(tx, connection, connection.connectionId) };
}

/** Replaces one connection's calendar choices. Adding a calendar shares more than before, so it needs the acknowledgment. */
export async function saveCalendarSelections(tx: Database, connection: McpOwnedConnection, ids: readonly string[], acknowledged: boolean, beforeSharingMore?: () => Promise<void>) {
  if (!connection.capabilities.includes("calendar.availability")) throw new McpAuthorizationError("invalid_capability", 400);
  const chosen = await proposedCalendarIds(tx, connection, ids);
  const existing = (await tx.select({ calendarId: mcpCalendarSelections.calendarId }).from(mcpCalendarSelections)
    .where(eq(mcpCalendarSelections.connectionId, connection.connectionId))).map((row) => row.calendarId);
  const added = chosen.filter((id) => !existing.includes(id)), removed = existing.filter((id) => !chosen.includes(id));
  if (added.length && !acknowledged) throw new McpAuthorizationError("acknowledgment_required", 400);
  // Only a change that shares more runs the caller's extra check; removing a calendar always goes through.
  if (added.length) await beforeSharingMore?.();
  if (removed.length) await tx.delete(mcpCalendarSelections).where(and(eq(mcpCalendarSelections.connectionId, connection.connectionId), inArray(mcpCalendarSelections.calendarId, removed)));
  if (added.length) await tx.insert(mcpCalendarSelections).values(added.map((calendarId) => ({
    householdId: connection.householdId, connectionId: connection.connectionId, userId: connection.userId, calendarId })));
  return { calendarIds: chosen, added: added.length, removed: removed.length };
}

/** Busy time on the given calendars. Callers pass only calendars the member can see. */
export async function availability(tx: Database, viewer: Viewer, calendarIds: readonly string[], from: string, to: string) {
  const [household] = await tx.select({ timezone: households.timezone }).from(households).where(eq(households.id, viewer.householdId));
  const zone = zoneOr(household?.timezone, "UTC");
  if (!calendarIds.length) return { zone, coverage: "no_calendars_selected" as const, externalCalendarsExcluded: false, truncated: false, busy: [] as BusyInterval[] };
  const ids = [...calendarIds], lower = addDaysIso(from, -1), upper = addDaysIso(to, 1);
  const events = await tx.select({
    startDate: calendarEvents.startDate, endDate: calendarEvents.endDate, startTime: calendarEvents.startTime, endTime: calendarEvents.endTime,
    allDay: calendarEvents.allDay, timeZone: calendarEvents.timeZone, bufferBeforeMinutes: calendarEvents.driveBufferBeforeMinutes,
    bufferAfterMinutes: calendarEvents.driveBufferAfterMinutes, recurringRuleId: calendarEvents.recurringRuleId,
  }).from(calendarEvents).where(and(eq(calendarEvents.householdId, viewer.householdId), inArray(calendarEvents.calendarId, ids), eq(calendarEvents.source, "local"),
    lte(calendarEvents.startDate, upper), sql`coalesce(${calendarEvents.endDate}, ${calendarEvents.startDate}) >= ${lower}::date`)).limit(AVAILABILITY_LIMITS.events + 1);
  const rules = await tx.select({
    id: recurringRules.id, rrule: recurringRules.rrule, startDate: recurringRules.startDate, endDate: recurringRules.endDate, durationDays: recurringRules.durationDays,
    startTime: recurringRules.startTime, endTime: recurringRules.endTime, allDay: recurringRules.allDay, timeZone: recurringRules.timeZone, lastGeneratedDate: recurringRules.lastGeneratedDate,
  }).from(recurringRules).where(and(eq(recurringRules.householdId, viewer.householdId), inArray(recurringRules.calendarId, ids), isNull(recurringRules.googleRecurringEventId),
    lte(recurringRules.startDate, upper), or(isNull(recurringRules.endDate), gte(recurringRules.endDate, addDaysIso(lower, -31))))).limit(AVAILABILITY_LIMITS.rules + 1);
  const [external] = await tx.select({ id: calendarEvents.id }).from(calendarEvents)
    .where(and(eq(calendarEvents.householdId, viewer.householdId), inArray(calendarEvents.calendarId, ids), eq(calendarEvents.source, "google"))).limit(1);
  const stored = new Set(events.filter((event) => event.recurringRuleId).map((event) => event.recurringRuleId + "|" + event.startDate));
  const sources: BusySource[] = [...events.slice(0, AVAILABILITY_LIMITS.events), ...rules.slice(0, AVAILABILITY_LIMITS.rules).flatMap((rule) => pendingOccurrences(rule, lower, upper, stored))];
  const result = busyIntervals(sources, from, to, zone);
  return { zone, coverage: "selected_calendars" as const, externalCalendarsExcluded: Boolean(external),
    truncated: result.truncated || events.length > AVAILABILITY_LIMITS.events || rules.length > AVAILABILITY_LIMITS.rules, busy: result.intervals };
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const instant = new Date(value + "T12:00:00Z");
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
});
const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const dayCount = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 1;

/** The complete field list an assistant can receive about a calendar. Nothing here describes an event. */
export const availabilityOutput = z.object({
  schemaVersion: z.literal(1), retrievedAt: z.iso.datetime(), householdTimezone: z.string().max(64), from: date, to: date,
  coverage: z.enum(["selected_calendars", "no_calendars_selected"]), recurringExpanded: z.literal(true),
  externalCalendarsExcluded: z.boolean(), truncated: z.boolean(),
  busy: z.array(z.object({ start: local, end: local, allDay: z.boolean() }).strict()).max(AVAILABILITY_LIMITS.intervals),
}).strict();
export const availabilityInput = z.object({ from: date, to: date.optional() }).strict()
  .refine((value) => { const days = dayCount(value.from, value.to ?? value.from); return days >= 1 && days <= AVAILABILITY_LIMITS.days; });

export async function availabilityPayload(tx: Database, viewer: Viewer, calendarIds: readonly string[], from: string, to: string) {
  const result = await availability(tx, viewer, calendarIds, from, to);
  return { schemaVersion: 1 as const, retrievedAt: new Date().toISOString(), householdTimezone: result.zone, from, to, coverage: result.coverage,
    recurringExpanded: true as const, externalCalendarsExcluded: result.externalCalendarsExcluded, truncated: result.truncated, busy: result.busy };
}

/** Seven days from the household's today: the window a consent preview shows. */
export async function previewWindow(tx: Database, householdId: string) {
  const [household] = await tx.select({ timezone: households.timezone }).from(households).where(eq(households.id, householdId));
  const from = todayIsoDateInTz(zoneOr(household?.timezone, "UTC"));
  return { from, to: addDaysIso(from, 6) };
}

export function calendarTools(): [McpReadTool] {
  return [{
    name: "get_calendar_availability", scopes: ["calendar:read"], capability: "calendar.availability", module: "calendar_sync", access: "read",
    description: "Read when the user is busy between two dates in the household's timezone (at most 14 days), on the calendars they chose to share. Returns merged busy intervals with local start and end times, and nothing else: never a title, location, attendee, calendar name or how many events there are, so do not guess what a block is. Time not listed is not guaranteed free. When externalCalendarsExcluded is true, events from a connected outside calendar are missing; when coverage is no_calendars_selected nothing is shared; when truncated is true the list is incomplete. Say so in each case. This cannot create or change events.",
    input: availabilityInput, output: availabilityOutput,
    async run(tx, identity, args) {
      const input = availabilityInput.parse(args), to = input.to ?? input.from;
      const [household] = await tx.select({ timezone: households.timezone }).from(households).where(eq(households.id, identity.householdId));
      const today = todayIsoDateInTz(zoneOr(household?.timezone, "UTC"));
      // A bounded window around today keeps a confused or manipulated assistant from walking the whole calendar.
      if (input.from < addDaysIso(today, -AVAILABILITY_LIMITS.pastDays) || to > addDaysIso(today, AVAILABILITY_LIMITS.futureDays)) throw new McpGatewayError("out_of_range", 400);
      return availabilityPayload(tx, identity, await selectedCalendarIds(tx, identity, identity.connectionId), input.from, to);
    },
  }];
}
