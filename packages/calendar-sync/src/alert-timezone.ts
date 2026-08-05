/** True if `tz` is a valid IANA timezone for Intl. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz?.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer device/subscription TZ, then optional user preference, then household, then UTC.
 * Used by reminder scans and client-clock UI (WHO-233).
 */
export function resolveAlertTimeZone(input: {
  deviceTimezone?: string | null;
  userTimezone?: string | null;
  householdTimezone?: string | null;
}): string {
  for (const candidate of [input.deviceTimezone, input.userTimezone, input.householdTimezone]) {
    if (isValidTimeZone(candidate)) return candidate!.trim();
  }
  return "UTC";
}
