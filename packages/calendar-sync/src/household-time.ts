/** Local calendar date YYYY-MM-DD in an IANA timezone. */
export function todayIsoDateInTz(timeZone: string): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** UTC weekday for a calendar ISO date: 0 = Sunday … 6 = Saturday. */
export function isoWeekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** Monday (ISO date) of the week containing `iso`. */
export function mondayOfWeekIso(iso: string): string {
  const day = isoWeekday(iso);
  const offset = day === 0 ? -6 : 1 - day;
  return addDaysIso(iso, offset);
}

export interface MonFriWeekRange {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
}

function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Current (or requested) Mon–Fri school week in household local calendar dates. */
export function monFriWeekRange(params: {
  timeZone: string;
  referenceDate?: string;
  weekStart?: string | null;
}): MonFriWeekRange {
  const today = params.referenceDate ?? todayIsoDateInTz(params.timeZone);
  const weekStart = params.weekStart?.trim()
    ? mondayOfWeekIso(params.weekStart.trim())
    : mondayOfWeekIso(today);
  const weekEnd = addDaysIso(weekStart, 4);
  const startLabel = formatShortDate(weekStart);
  const endLabel = formatShortDate(weekEnd);
  const year = weekStart.slice(0, 4);
  const weekLabel =
    weekStart.slice(0, 4) === weekEnd.slice(0, 4)
      ? `${startLabel}–${endLabel}, ${year}`
      : `${startLabel}, ${weekStart.slice(0, 4)} – ${endLabel}, ${weekEnd.slice(0, 4)}`;
  return { weekStart, weekEnd, weekLabel };
}

export function isoDateInRange(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end;
}

const MAX_WEEKS_IN_RANGE = 26;

/** Mon–Fri weeks whose calendar span overlaps `[fromIso, toIso]` (inclusive). */
export function weeksOverlappingRange(
  fromIso: string,
  toIso: string,
  timeZone: string,
): MonFriWeekRange[] {
  if (fromIso > toIso) return [];
  const weeks: MonFriWeekRange[] = [];
  let monday = mondayOfWeekIso(fromIso);
  while (weeks.length < MAX_WEEKS_IN_RANGE) {
    const range = monFriWeekRange({ timeZone, weekStart: monday });
    if (range.weekStart > toIso) break;
    if (range.weekEnd >= fromIso) weeks.push(range);
    monday = addDaysIso(monday, 7);
  }
  return weeks;
}

export { MAX_WEEKS_IN_RANGE };

export function localDateOfInstant(instant: Date, timeZone: string): string {
  try {
    return instant.toLocaleDateString("en-CA", { timeZone });
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/** Local hour (0–23) for an instant in an IANA timezone. */
export function localHourInTz(instant: Date, timeZone: string): number {
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(instant);
    return Number(hour) % 24;
  } catch {
    return instant.getUTCHours();
  }
}

/** Local HH:mm (24h) for an instant in an IANA timezone. */
export function localTimeHhmm(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(instant);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    const hour = String(Number(get("hour")) % 24).padStart(2, "0");
    return `${hour}:${get("minute")}`;
  } catch {
    return instant.toISOString().slice(11, 16);
  }
}

export function isMidnightInTz(instant: Date, timeZone: string): boolean {
  return localTimeHhmm(instant, timeZone) === "00:00";
}

export function formatTimeLabelInTz(instant: Date, timeZone: string): string {
  try {
    return instant.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
  } catch {
    return instant.toISOString().slice(11, 16);
  }
}

/** Minimum gap between overdue chore/school reminder pushes. */
export const OVERDUE_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type DueReminderKind = "due_tomorrow" | "due_today" | "overdue";

/** Decide whether a due-date item should fire a push on this scan. */
export function classifyDueReminder(params: {
  dueDate: string;
  today: string;
  lastSentAt: Date | null;
  now: Date;
  timeZone: string;
}): DueReminderKind | null {
  const { dueDate, today, lastSentAt, now, timeZone } = params;
  const tomorrow = addDaysIso(today, 1);

  const sentToday =
    lastSentAt != null && localDateOfInstant(lastSentAt, timeZone) >= today;

  if (dueDate === tomorrow) {
    return sentToday ? null : "due_tomorrow";
  }
  if (dueDate === today) {
    return sentToday ? null : "due_today";
  }
  if (dueDate < today) {
    if (!lastSentAt) return "overdue";
    if (now.getTime() - lastSentAt.getTime() >= OVERDUE_REMINDER_COOLDOWN_MS) {
      return "overdue";
    }
    return null;
  }
  return null;
}

/** All-day events fire reminders at this local hour (documented in runbook). */
export const ALL_DAY_REMINDER_HOUR = 9;

type ZonedParts = { date: string; hour: number; minute: number };

function formatInTz(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };
}

/** Convert a local date+time in `timeZone` to a UTC instant. */
export function zonedLocalToUtc(date: string, time: string, timeZone: string): Date {
  const [hh, mm] = time.split(":").map((x) => Number(x));
  let utc = new Date(
    `${date}T${String(hh).padStart(2, "0")}:${String(mm ?? 0).padStart(2, "0")}:00.000Z`,
  );
  for (let i = 0; i < 5; i++) {
    const local = formatInTz(utc, timeZone);
    const targetMin = hh * 60 + (mm ?? 0);
    const localMin = local.hour * 60 + local.minute;
    let deltaMin = targetMin - localMin;
    if (local.date < date) deltaMin += 24 * 60;
    if (local.date > date) deltaMin -= 24 * 60;
    if (deltaMin === 0 && local.date === date) break;
    utc = new Date(utc.getTime() + deltaMin * 60 * 1000);
  }
  return utc;
}

export function eventStartInstant(
  event: {
    startDate: string;
    startTime: string | null;
    allDay: boolean;
    timeZone: string | null;
  },
  householdTz: string,
): Date {
  const tz = event.timeZone?.trim() || householdTz || "UTC";
  if (event.allDay || !event.startTime) {
    return zonedLocalToUtc(
      event.startDate,
      `${String(ALL_DAY_REMINDER_HOUR).padStart(2, "0")}:00`,
      tz,
    );
  }
  const time = event.startTime.length >= 5 ? event.startTime.slice(0, 5) : event.startTime;
  return zonedLocalToUtc(event.startDate, time, tz);
}
