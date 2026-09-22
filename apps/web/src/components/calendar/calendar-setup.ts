/** Household calendar is usable when at least one lane exists and Google import is not pending. */
export function calendarSetupComplete({
  connected,
  hasCalendars,
  needsImport,
}: {
  connected: boolean;
  hasCalendars: boolean;
  needsImport: boolean;
}): boolean {
  void connected;
  return hasCalendars && !needsImport;
}
