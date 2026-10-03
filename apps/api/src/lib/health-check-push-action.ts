import type { Env } from "@domi-ops/config";
import type { HealthCheckPushActionClaims } from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import { getBaseDb, healthChecks, householdMembers, withHouseholdContext } from "@domi-ops/db";
import { addDaysIso, loadCheckSlotStatuses, localDateOfInstant } from "@domi-ops/calendar-sync";
import { and, eq, isNull } from "drizzle-orm";
import { isHouseholdModuleEnabled } from "./household-modules.js";
import { hasHealthSegmentAccess } from "./health-access.js";
import { healthCheckVisibleWhere } from "./health-check-access.js";
import { recordCheck } from "./health-check-logging.js";
import { householdTimezone } from "./household-time.js";

export type CheckPushActionResult =
  | { status: 200; body: { ok: true; alreadyLogged: true; slotStatus: string } }
  | { status: 201; body: { ok: true; alreadyLogged: false; log: unknown } }
  | { status: 403 | 404; body: { error: string } };

function validTimeZone(value: string | undefined): string | null {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/**
 * Skip one slot of a check from a push notification button (WHO-388). The token has already been
 * verified; what it proves is that the server sent this person a reminder for this slot, not that
 * they may still act on it, so access is re-checked against the person's current permissions.
 *
 * A reminder button can be tapped long after the reminder, so this never overwrites an answer: a
 * slot that has been logged, skipped or matched to a reading in the meantime is left alone and the
 * caller is told so. (A skip from the Log tab replaces an answer on purpose; a stale notification
 * must not.) A slot that no longer exists, because the check was edited, paused or deleted, is not
 * found.
 *
 * Runs in the household's own database context: this endpoint has no session to carry one.
 * `timeZone` is the device's, which decided which instant the reminder was for.
 */
export async function skipCheckSlotFromPushAction(
  db: Database,
  env: Env,
  claims: HealthCheckPushActionClaims,
  input: { timeZone?: string; now?: Date } = {},
): Promise<CheckPushActionResult> {
  const scheduledAt = new Date(claims.scheduledAt);
  const now = input.now ?? new Date();

  return withHouseholdContext(getBaseDb(db), claims.householdId, async (tx): Promise<CheckPushActionResult> => {
    if (!(await isHouseholdModuleEnabled(tx, env, claims.householdId, "health"))) {
      return { status: 403, body: { error: "module_disabled" } };
    }

    const [member] = await tx
      .select({ memberId: householdMembers.id, role: householdMembers.role, userId: householdMembers.userId })
      .from(householdMembers)
      .where(and(eq(householdMembers.userId, claims.userId), eq(householdMembers.householdId, claims.householdId)))
      .limit(1);
    if (!member?.userId) return { status: 403, body: { error: "forbidden" } };
    const auth = {
      userId: member.userId,
      householdId: claims.householdId,
      memberId: member.memberId,
      role: member.role,
    };

    // Not visible and not there look the same.
    const [check] = await tx
      .select()
      .from(healthChecks)
      .where(
        and(
          eq(healthChecks.id, claims.checkId),
          eq(healthChecks.householdId, claims.householdId),
          isNull(healthChecks.deletedAt),
          healthCheckVisibleWhere(tx, auth),
        ),
      )
      .limit(1);
    if (!check) return { status: 404, body: { error: "not_found" } };
    if (!(await hasHealthSegmentAccess(tx, auth, check.memberId, "events", "write"))) {
      return { status: 403, body: { error: "forbidden" } };
    }

    const timeZone = validTimeZone(input.timeZone) ?? (await householdTimezone(tx, claims.householdId));
    const day = localDateOfInstant(scheduledAt, timeZone);
    const statuses = await loadCheckSlotStatuses(tx, env, {
      checks: [check],
      from: addDaysIso(day, -1),
      to: addDaysIso(day, 1),
      timeZone,
      now,
      includeAwaitingFirst: false,
    });
    const minute = Math.floor(scheduledAt.getTime() / 60_000);
    const slot = (statuses.get(check.id) ?? []).find((s) => Math.floor(s.scheduledAt.getTime() / 60_000) === minute);
    if (!slot) return { status: 404, body: { error: "slot_not_found" } };
    if (slot.status !== "upcoming" && slot.status !== "due" && slot.status !== "overdue") {
      return { status: 200, body: { ok: true, alreadyLogged: true, slotStatus: slot.status } };
    }

    // "bulk" fills a gap and never replaces a row that appeared since the status was read.
    const { log, outcome } = await recordCheck(tx, env, {
      check,
      loggedByUserId: auth.userId,
      status: "skipped",
      scheduledAt: slot.scheduledAt,
      loggedAt: now,
      source: "bulk",
    });
    return outcome === "inserted"
      ? { status: 201, body: { ok: true, alreadyLogged: false, log } }
      : { status: 200, body: { ok: true, alreadyLogged: true, slotStatus: log.status } };
  });
}
