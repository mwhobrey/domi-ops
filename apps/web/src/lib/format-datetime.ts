/** "Sep 22, 5:23 PM" — adds the year only when it isn't the current one. No seconds. */
export function formatDateTime(value: string | Date, now: Date = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Whole days since `value`, for "stale" checks. */
export function daysSince(value: string | Date, now: Date = new Date()): number {
  const d = typeof value === "string" ? new Date(value) : value;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

/** "Sep 22" */
export function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Tuesday, September 22" */
export function formatLongDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** "Tue, Sep 22, 5:23 PM" */
export function formatWeekdayDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
