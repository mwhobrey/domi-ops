export const REMINDER_OFFSET_COLUMNS = [
  "notify_minutes",
  "reminder_minutes",
  "alert_minutes",
  "minutes_before",
] as const;

export function reminderOffsetsFromHomeHubRow(
  r: Record<string, unknown>,
  availableColumns: Set<string>,
): number[] {
  for (const col of REMINDER_OFFSET_COLUMNS) {
    if (!availableColumns.has(col)) continue;
    const raw = r[col];
    if (raw == null || raw === "") continue;
    const minutes = Math.round(Number(raw));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080) continue;
    return [minutes];
  }
  return [];
}
