import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { healthChecks } from "@domi-ops/db";
import { formatTimeLabelInTz, loadCheckSlotStatuses } from "@domi-ops/calendar-sync";
import { and, eq, isNull } from "drizzle-orm";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";
import { healthCheckVisibleWhere } from "./health-check-access.js";

export type PendingCheckSlot = {
  checkId: string;
  memberId: string;
  name: string;
  scheduledAt: string;
  scheduledTimeLabel: string;
  status: "upcoming" | "due" | "overdue";
};

export type CheckGlance = {
  /** Today's slots still waiting for an answer, in time order. */
  pendingChecks: PendingCheckSlot[];
  /** Today's slots answered with a reading, out of all of today's slots. */
  checkProgress: { done: number; total: number };
};

/**
 * What the dashboard and the Health page's header need to know about today's scheduled checks:
 * which slots are still waiting and how many are done (WHO-392). One slot-status load for all the
 * viewer's visible checks, however many there are. Days are in `timeZone`, the viewer's.
 */
export async function loadCheckGlance(
  db: Database,
  env: Env,
  auth: { householdId: string; userId: string; memberId: string; role: string },
  today: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<CheckGlance> {
  const checks = await db
    .select()
    .from(healthChecks)
    .where(
      and(healthCheckVisibleWhere(db, auth), eq(healthChecks.enabled, true), isNull(healthChecks.deletedAt)),
    );
  if (checks.length === 0) return { pendingChecks: [], checkProgress: { done: 0, total: 0 } };

  const statuses = await loadCheckSlotStatuses(db, env, {
    checks,
    from: today,
    to: today,
    timeZone,
    now,
    includeAwaitingFirst: false,
  });

  const pendingChecks: PendingCheckSlot[] = [];
  let done = 0;
  let total = 0;
  for (const check of checks) {
    const name = decryptHealthFieldOrPassthrough(check.name, env) ?? "Health check";
    for (const slot of statuses.get(check.id) ?? []) {
      total += 1;
      if (slot.status === "done") done += 1;
      if (slot.status === "upcoming" || slot.status === "due" || slot.status === "overdue") {
        pendingChecks.push({
          checkId: check.id,
          memberId: check.memberId,
          name,
          scheduledAt: slot.scheduledAt.toISOString(),
          scheduledTimeLabel: formatTimeLabelInTz(slot.scheduledAt, timeZone),
          status: slot.status,
        });
      }
    }
  }
  pendingChecks.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.name.localeCompare(b.name));
  return { pendingChecks, checkProgress: { done, total } };
}
