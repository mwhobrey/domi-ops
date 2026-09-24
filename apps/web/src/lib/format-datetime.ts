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
