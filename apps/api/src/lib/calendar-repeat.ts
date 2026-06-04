const WEEKDAY_RRULE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export type RepeatRuleInput = {
  freq: "daily" | "weekly" | "monthly";
  interval?: number;
  until?: string;
  count?: number;
  startDate: string;
};

export function buildRrule(input: RepeatRuleInput): string {
  const interval = Math.max(1, Math.min(99, input.interval ?? 1));
  const freq = input.freq.toUpperCase();
  const parts = [`FREQ=${freq}`, `INTERVAL=${interval}`];
  if (input.freq === "weekly") {
    const dow = new Date(`${input.startDate}T12:00:00`).getDay();
    parts.push(`BYDAY=${WEEKDAY_RRULE[dow]}`);
  }
  if (input.until) parts.push(`UNTIL=${input.until.replace(/-/g, "")}`);
  if (input.count) parts.push(`COUNT=${Math.max(1, input.count)}`);
  return parts.join(";");
}
