export type BillInterval = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export interface RecurringBill {
  id: string;
  title: string;
  amount: number;
  category: string | null;
  memberId: string | null;
  interval: BillInterval;
  anchorDate: string;
  nextAt: string;
  enabled: boolean;
}

export const BILL_INTERVAL_OPTIONS: { value: BillInterval; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Every 3 months" },
  { value: "yearly", label: "Yearly" },
];

export function billIntervalLabel(interval: BillInterval): string {
  return BILL_INTERVAL_OPTIONS.find((o) => o.value === interval)?.label ?? interval;
}

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "Due today", "Due tomorrow", "Due in 5 days", or "Due Oct 31" past two weeks out. */
export function billDueLabel(nextAt: string, today: string): string {
  const days = dayDiff(today, nextAt);
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 14) return `Due in ${days} days`;
  const d = new Date(`${nextAt}T12:00:00`);
  const sameYear = nextAt.slice(0, 4) === today.slice(0, 4);
  return `Due ${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })}`;
}

/** Enabled bills first by next due date, then paused ones by title. */
export function sortBills(bills: RecurringBill[]): RecurringBill[] {
  return [...bills].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.enabled) return a.nextAt.localeCompare(b.nextAt);
    return a.title.localeCompare(b.title);
  });
}

/** Sum of enabled bills due within [today, today + days]. */
export function upcomingBillsTotal(bills: RecurringBill[], today: string, days: number): number {
  return bills
    .filter((b) => b.enabled && dayDiff(today, b.nextAt) >= 0 && dayDiff(today, b.nextAt) <= days)
    .reduce((sum, b) => sum + b.amount, 0);
}
