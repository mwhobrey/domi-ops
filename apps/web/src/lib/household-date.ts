/**
 * "Today" as the household sees it: the calendar date in the household's timezone, the same
 * day the server's recurring jobs (chores, shopping, bills) use. Falls back to the device's
 * date when the zone is missing or invalid.
 */
export function todayIsoInTimeZone(timeZone: string | null | undefined, now: Date = new Date()): string {
  if (timeZone) {
    try {
      return now.toLocaleDateString("en-CA", { timeZone });
    } catch {
      /* invalid zone: fall through to the device date */
    }
  }
  return now.toLocaleDateString("en-CA");
}
