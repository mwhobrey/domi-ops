import type { Database } from "@domi-ops/db";
import { calendarEvents, recurringRules } from "@domi-ops/db";
import { and, eq, gte, lte } from "drizzle-orm";
import {
  parseRuleReminderOffsets,
  replaceEventReminders,
} from "./event-reminders.js";
import { addDaysIso } from "./household-time.js";

export type ParsedRrule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  byDay?: number;
  until?: string;
  count?: number;
};

export function parseRrule(rrule: string): ParsedRrule | null {
  const upper = rrule.toUpperCase();
  const freqMatch = upper.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/);
  if (!freqMatch) return null;
  const freq = freqMatch[1] as ParsedRrule["freq"];
  const intervalMatch = upper.match(/INTERVAL=(\d+)/);
  const interval = intervalMatch ? Math.max(1, Number(intervalMatch[1])) : 1;
  const dayMatch = upper.match(/BYDAY=([A-Z]{2})/);
  const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const byDay = dayMatch ? dayMap[dayMatch[1]!] : undefined;
  const untilMatch = upper.match(/UNTIL=(\d{8})/);
  const until = untilMatch
    ? `${untilMatch[1]!.slice(0, 4)}-${untilMatch[1]!.slice(4, 6)}-${untilMatch[1]!.slice(6, 8)}`
    : undefined;
  const countMatch = upper.match(/COUNT=(\d+)/);
  const count = countMatch ? Number(countMatch[1]) : undefined;
  return { freq, interval, byDay, until, count };
}

const DAY_MS = 86_400_000;
/** Guards against a runaway loop on a malformed rule; ~137 years of a daily series. */
const MAX_STEPS = 50_000;

function utcMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * The k-th candidate of a series, or null when that step doesn't exist (the 31st in a 30-day
 * month, Feb 29 in a common year, a BYDAY earlier in the first week than the series start).
 * Every step is anchored on the series start, so "every 2 weeks" keeps its phase no matter
 * where materialization resumes.
 */
function nthCandidate(rule: ParsedRrule, seriesStart: string, k: number): string | null {
  const base = utcMs(seriesStart);
  const step = k * rule.interval;
  if (rule.freq === "DAILY") return isoOf(base + step * DAY_MS);
  if (rule.freq === "WEEKLY") {
    const startDow = new Date(base).getUTCDay();
    const target = rule.byDay ?? startDow;
    const ms = base + (step * 7 + target - startDow) * DAY_MS;
    return ms < base ? null : isoOf(ms);
  }
  const [y, m, d] = seriesStart.split("-").map(Number) as [number, number, number];
  if (rule.freq === "MONTHLY") {
    const total = m - 1 + step;
    const year = y + Math.floor(total / 12);
    const month = total % 12;
    if (d > daysInMonth(year, month)) return null;
    return isoOf(Date.UTC(year, month, d));
  }
  const year = y + step;
  if (d > daysInMonth(year, m - 1)) return null;
  return isoOf(Date.UTC(year, m - 1, d));
}

/**
 * Occurrence start dates of a series that fall inside [from, to]. COUNT is counted from the
 * series start, not from `from`, so resuming materialization never over-generates.
 */
export function occurrenceDates(
  rule: ParsedRrule,
  seriesStart: string,
  from: string,
  to: string,
  seriesEnd?: string | null,
): string[] {
  let end = to;
  if (rule.until && rule.until < end) end = rule.until;
  if (seriesEnd && seriesEnd < end) end = seriesEnd;
  if (seriesStart > end || from > end) return [];

  const out: string[] = [];
  let counted = 0;
  for (let k = 0; k < MAX_STEPS; k++) {
    const date = nthCandidate(rule, seriesStart, k);
    if (date === null) continue;
    if (date > end) break;
    counted += 1;
    if (rule.count != null && counted > rule.count) break;
    if (date >= from) out.push(date);
  }
  return out;
}

export async function materializeRecurringForHousehold(
  db: Database,
  householdId: string,
  horizonDays = 120,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = addDaysIso(today, horizonDays);
  const rules = await db
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.householdId, householdId));

  let created = 0;
  for (const rule of rules) {
    const parsed = parseRrule(rule.rrule);
    if (!parsed) continue;
    const offsets = parseRuleReminderOffsets(rule.reminderOffsetsJson);
    const from =
      rule.lastGeneratedDate && rule.lastGeneratedDate > rule.startDate
        ? addDaysIso(rule.lastGeneratedDate, 1)
        : rule.startDate;
    const dates = occurrenceDates(parsed, rule.startDate, from, horizon, rule.endDate);
    if (dates.length === 0) continue;

    const existing = await db
      .select({ startDate: calendarEvents.startDate })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.recurringRuleId, rule.id),
          gte(calendarEvents.startDate, from),
          lte(calendarEvents.startDate, horizon),
        ),
      );
    const have = new Set(existing.map((e) => e.startDate));

    for (const date of dates) {
      if (have.has(date)) continue;
      const [ev] = await db
        .insert(calendarEvents)
        .values({
          householdId: rule.householdId,
          calendarId: rule.calendarId,
          title: rule.title,
          description: rule.description,
          categoryKey: rule.categoryKey,
          startDate: date,
          // rule.endDate ends the series; each occurrence keeps the first one's span.
          endDate: rule.durationDays > 0 ? addDaysIso(date, rule.durationDays) : null,
          startTime: rule.allDay ? null : rule.startTime,
          endTime: rule.allDay ? null : rule.endTime,
          allDay: rule.allDay,
          timeZone: rule.timeZone,
          location: rule.location,
          attendeeMemberIds: rule.attendeeMemberIds,
          color: rule.color,
          source: "local",
          recurringRuleId: rule.id,
        })
        .returning({ id: calendarEvents.id });
      if (ev && offsets.length > 0) {
        await replaceEventReminders(db, ev.id, rule.householdId, offsets);
      }
      created += 1;
    }

    const last = dates[dates.length - 1]!;
    await db
      .update(recurringRules)
      .set({ lastGeneratedDate: last > today ? today : last })
      .where(eq(recurringRules.id, rule.id));
  }
  return created;
}
