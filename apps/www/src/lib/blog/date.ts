const TIME_ZONE = "America/Chicago";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `dateIso` (YYYY-MM-DD) has started in America/Chicago. Midnight on that date is inclusive. */
export function isPostPublished(dateIso: string, now: Date = new Date()): boolean {
  return now.getTime() >= chicagoMidnightUtcMs(dateIso);
}

/** Format a calendar date for display without applying a timezone shift. */
export function formatPostDate(dateIso: string): string {
  const parts = parseDateOnly(dateIso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function parseDateOnly(dateIso: string): { year: number; month: number; day: number } {
  const match = DATE_ONLY.exec(dateIso);
  if (!match) {
    throw new Error(`Invalid blog date "${dateIso}"; expected YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Invalid blog date "${dateIso}"`);
  }
  return { year, month, day };
}

/** UTC millisecond timestamp of 00:00:00 America/Chicago on `dateIso`. */
export function chicagoMidnightUtcMs(dateIso: string): number {
  const { year, month, day } = parseDateOnly(dateIso);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstOffset = tzOffsetMs(utcGuess, TIME_ZONE);
  const instant = utcGuess - firstOffset;
  const secondOffset = tzOffsetMs(instant, TIME_ZONE);
  if (secondOffset !== firstOffset) {
    return utcGuess - secondOffset;
  }
  return instant;
}

/** Offset such that `utcMs + offset` is the wall-clock time in `timeZone` expressed as UTC fields. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((entry) => entry.type === type);
    if (!part) throw new Error(`Missing ${type} in time-zone format`);
    return Number(part.value);
  };
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - utcMs;
}
