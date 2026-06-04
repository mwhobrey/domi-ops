import type { Database } from "@whome/db";
import { calendarEvents, recurringRules } from "@whome/db";
import { and, eq, gte, lte } from "drizzle-orm";

export type ParsedRrule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  byDay?: number;
  until?: string;
  count?: number;
};

export function parseRrule(rrule: string): ParsedRrule | null {
  const upper = rrule.toUpperCase();
  const freqMatch = upper.match(/FREQ=(DAILY|WEEKLY|MONTHLY)/);
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

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonthsIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function datesForRule(
  rule: typeof recurringRules.$inferSelect,
  from: string,
  to: string,
): string[] {
  const parsed = parseRrule(rule.rrule);
  if (!parsed) return [];
  const hardEnd = parsed.until && parsed.until < to ? parsed.until : to;
  const ruleEnd = rule.endDate && rule.endDate < hardEnd ? rule.endDate : hardEnd;
  const start = rule.startDate > from ? rule.startDate : from;
  if (start > ruleEnd) return [];

  const out: string[] = [];
  const maxCount = parsed.count ?? 366;
  let generated = 0;

  if (parsed.freq === "DAILY") {
    let cur = start;
    while (cur <= ruleEnd && generated < maxCount) {
      out.push(cur);
      generated += 1;
      cur = addDaysIso(cur, parsed.interval);
    }
    return out;
  }

  if (parsed.freq === "WEEKLY") {
    const targetDow = parsed.byDay ?? new Date(`${rule.startDate}T12:00:00`).getDay();
    let probe = start;
    while (probe <= ruleEnd && new Date(`${probe}T12:00:00`).getDay() !== targetDow) {
      probe = addDaysIso(probe, 1);
    }
    let cur = probe;
    while (cur <= ruleEnd && generated < maxCount) {
      out.push(cur);
      generated += 1;
      cur = addDaysIso(cur, 7 * parsed.interval);
    }
    return out;
  }

  const dom = new Date(`${rule.startDate}T12:00:00`).getDate();
  let cur = rule.startDate < start ? start : rule.startDate;
  const anchor = new Date(`${cur}T12:00:00`);
  if (anchor.getDate() !== dom) {
    cur = addDaysIso(cur, 1);
    while (cur <= ruleEnd && new Date(`${cur}T12:00:00`).getDate() !== dom) {
      cur = addDaysIso(cur, 1);
    }
  }
  while (cur <= ruleEnd && generated < maxCount) {
    out.push(cur);
    generated += 1;
    cur = addMonthsIso(cur, parsed.interval);
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
    const from =
      rule.lastGeneratedDate && rule.lastGeneratedDate > rule.startDate
        ? addDaysIso(rule.lastGeneratedDate, 1)
        : rule.startDate;
    const dates = datesForRule(rule, from, horizon);
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
      await db.insert(calendarEvents).values({
        householdId: rule.householdId,
        calendarId: rule.calendarId,
        title: rule.title,
        description: rule.description,
        categoryKey: rule.categoryKey,
        startDate: date,
        endDate: rule.endDate,
        startTime: rule.allDay ? null : rule.startTime,
        endTime: rule.allDay ? null : rule.endTime,
        allDay: rule.allDay,
        color: rule.color,
        source: "local",
        recurringRuleId: rule.id,
      });
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
