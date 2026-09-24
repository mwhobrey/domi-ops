import type { Database } from "@domi-ops/db";
import { expenseRecurring, expenses } from "@domi-ops/db";
import { and, eq, lte } from "drizzle-orm";
import { householdTodayIsoDate } from "./household-time.js";

export type BillInterval = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export const BILL_INTERVALS: BillInterval[] = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
];

/** Most bills a single catch-up run will post; older missed dates are skipped. */
export const MAX_BILL_CATCH_UP = 24;
const MAX_STEPS = 10_000;

export function normalizeBillInterval(raw: unknown): BillInterval | null {
  return BILL_INTERVALS.includes(raw as BillInterval) ? (raw as BillInterval) : null;
}

/**
 * The k-th due date of a bill. Month-based intervals clamp to the month's last day but always
 * step from the anchor, so a bill due on the 31st lands on Feb 28 and then back on Mar 31.
 */
export function billDateAt(interval: BillInterval, anchor: string, k: number): string {
  const [y, m, d] = anchor.split("-").map(Number) as [number, number, number];
  if (interval === "weekly" || interval === "biweekly") {
    const days = k * (interval === "weekly" ? 7 : 14);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }
  const months = k * (interval === "monthly" ? 1 : interval === "quarterly" ? 3 : 12);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

/** First due date on or after `date`. */
export function nextBillDateOnOrAfter(interval: BillInterval, anchor: string, date: string): string {
  for (let k = 0; k < MAX_STEPS; k++) {
    const due = billDateAt(interval, anchor, k);
    if (due >= date) return due;
  }
  return date;
}

/**
 * Due dates from `nextAt` through `today` (capped to the most recent MAX_BILL_CATCH_UP), plus
 * the next due date after today.
 */
export function dueBillDates(
  interval: BillInterval,
  anchor: string,
  nextAt: string,
  today: string,
): { dates: string[]; nextAt: string } {
  const dates: string[] = [];
  for (let k = 0; k < MAX_STEPS; k++) {
    const due = billDateAt(interval, anchor, k);
    if (due > today) return { dates: dates.slice(-MAX_BILL_CATCH_UP), nextAt: due };
    if (due >= nextAt) dates.push(due);
  }
  return { dates: dates.slice(-MAX_BILL_CATCH_UP), nextAt: today };
}

export function serializeExpenseRecurring(row: typeof expenseRecurring.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    amount: row.amount,
    category: row.category,
    memberId: row.memberId ?? null,
    interval: row.interval as BillInterval,
    anchorDate: row.anchorDate,
    nextAt: row.nextAt,
    enabled: row.enabled,
  };
}

/** Posts every bill that has come due in the household's timezone. Returns how many posted. */
export async function materializeDueBills(db: Database, householdId: string): Promise<number> {
  const today = await householdTodayIsoDate(db, householdId);
  const due = await db
    .select()
    .from(expenseRecurring)
    .where(
      and(
        eq(expenseRecurring.householdId, householdId),
        eq(expenseRecurring.enabled, true),
        lte(expenseRecurring.nextAt, today),
      ),
    );

  let created = 0;
  for (const bill of due) {
    const interval = normalizeBillInterval(bill.interval) ?? "monthly";
    const { dates, nextAt } = dueBillDates(interval, bill.anchorDate, bill.nextAt, today);
    if (dates.length > 0) {
      const inserted = await db
        .insert(expenses)
        .values(
          dates.map((expenseDate) => ({
            householdId,
            title: bill.title,
            amount: bill.amount,
            category: bill.category,
            expenseDate,
            memberId: bill.memberId,
            createdByDisplayName: bill.createdByDisplayName,
            recurringId: bill.id,
          })),
        )
        .onConflictDoNothing({ target: [expenses.recurringId, expenses.expenseDate] })
        .returning({ id: expenses.id });
      created += inserted.length;
    }
    await db
      .update(expenseRecurring)
      .set({ nextAt })
      .where(eq(expenseRecurring.id, bill.id));
  }
  return created;
}
