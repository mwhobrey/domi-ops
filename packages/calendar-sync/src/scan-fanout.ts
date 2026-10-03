import type { Database } from "@domi-ops/db";
import {
  calendarEventReminders,
  calendarEvents,
  chores,
  expenseBudgets,
  households,
  schoolClasses,
} from "@domi-ops/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { enqueueForHouseholds, type EnqueueHouseholdScan } from "./household-scan-fanout.js";

/**
 * The tick side of each per-household scan (see household-scan-fanout.ts): pick the households that
 * could have work, using the same cheap condition the scan itself starts from, and enqueue them.
 * Run cross-tenant, read-only. A household picked here that turns out to have nothing to do just
 * makes a job that returns 0.
 */
type Deps = { enqueue: EnqueueHouseholdScan; now?: Date };

export async function fanOutCalendarReminderScans(db: Database, deps: Deps): Promise<number> {
  const rows = await db
    .selectDistinct({ id: calendarEvents.householdId })
    .from(calendarEventReminders)
    .innerJoin(calendarEvents, eq(calendarEventReminders.eventId, calendarEvents.id))
    .where(and(eq(calendarEventReminders.enabled, true), isNull(calendarEventReminders.lastSentAt)));
  return enqueueForHouseholds("calendar.reminder.household", rows.map((r) => r.id), deps);
}

/** Households with an open chore that has a due date. Serves both the reminder and the digest. */
async function householdsWithDatedOpenChores(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: chores.householdId })
    .from(chores)
    .where(and(eq(chores.done, false), isNotNull(chores.dueDate)));
  return rows.map((r) => r.id);
}

export async function fanOutChoreReminderScans(db: Database, deps: Deps): Promise<number> {
  return enqueueForHouseholds("chore.reminder.household", await householdsWithDatedOpenChores(db), deps);
}

export async function fanOutChoreDigestScans(db: Database, deps: Deps): Promise<number> {
  return enqueueForHouseholds("chore.digest.household", await householdsWithDatedOpenChores(db), deps);
}

export async function fanOutBudgetAlertScans(db: Database, deps: Deps): Promise<number> {
  const rows = await db.selectDistinct({ id: expenseBudgets.householdId }).from(expenseBudgets);
  return enqueueForHouseholds("expense.budget.household", rows.map((r) => r.id), deps);
}

export async function fanOutSchoolReminderScans(db: Database, deps: Deps): Promise<number> {
  const rows = await db
    .selectDistinct({ id: schoolClasses.householdId })
    .from(schoolClasses)
    .where(eq(schoolClasses.archived, false));
  return enqueueForHouseholds("school.reminder.household", rows.map((r) => r.id), deps);
}

export async function fanOutDriveQuotaScans(db: Database, deps: Deps): Promise<number> {
  const rows = await db
    .select({ id: households.id })
    .from(households)
    .where(isNotNull(households.storageQuotaBytes));
  return enqueueForHouseholds("drive.quota.household", rows.map((r) => r.id), deps);
}
