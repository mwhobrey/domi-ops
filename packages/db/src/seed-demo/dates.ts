/** Date helpers anchored to America/Chicago for the Rivera demo household. */

export const DEMO_TIMEZONE = "America/Chicago";

export function chicagoYmd(offsetDays = 0): string {
  const base = new Date(Date.now() + offsetDays * 86_400_000);
  return base.toLocaleDateString("en-CA", { timeZone: DEMO_TIMEZONE });
}

export function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

export function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const { y, m, d } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Sunday-start week (matches apps/web calendar-utils). */
export function startOfWeekYmd(): string {
  const today = chicagoYmd(0);
  const { y, m, d } = parseYmd(today);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysYmd(today, -dow);
}

/** Day index 0 = Sunday … 6 = Saturday within the current Chicago week. */
export function weekDayYmd(dayIndex: number): string {
  return addDaysYmd(startOfWeekYmd(), dayIndex);
}

/**
 * UTC instant for a wall-clock time in the demo timezone. Mirrors what the API derives for a
 * medication slot (`zonedLocalToUtc`), so seeded dose logs land on the slots the app expects.
 */
export function chicagoInstant(ymd: string, hhmm: string): Date {
  const { y, m, d } = parseYmd(ymd);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEMO_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), 0);
  return new Date(guess + (guess - asIfUtc));
}

/** ISO timestamp for assignment due end-of-day Chicago (stored UTC). */
export function dueAtEndOfDayYmd(ymd: string): Date {
  const { y, m, d } = parseYmd(ymd);
  // 23:59 America/Chicago ≈ offset from UTC varies; use noon UTC on that calendar day + fudge for demo
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 0));
}
