import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { healthCheckLogs, healthEvents } from "@domi-ops/db";
import type { healthChecks } from "@domi-ops/db";
import { and, eq, ne } from "drizzle-orm";
import { isUniqueViolationError } from "./db-errors.js";
import { encryptHealthField } from "./health-crypto.js";
import { serializeHealthCheckLog } from "./health-check-serialize.js";

type HealthCheckRow = typeof healthChecks.$inferSelect;
type HealthCheckLogRow = typeof healthCheckLogs.$inferSelect;

/**
 * Who's asking to log this slot. Decides what happens when a log already exists for the same
 * `(checkId, scheduledAt)`, exactly like medication doses (WHO-280):
 *
 * - `"single"` — an individual action on one slot (the Log / Skip buttons, a per-check push
 *   action). The person is deciding about this exact slot, so it **overrides** any prior log.
 * - `"bulk"` — a group action touching several checks at once. It only **fills gaps**: a slot
 *   already logged (done *or* skipped) is left exactly as it was.
 */
export type CheckLogSource = "single" | "bulk";

export type CheckLogStatus = "done" | "skipped" | "missed";

export type RecordCheckOutcome = "inserted" | "updated" | "unchanged";

export type RecordCheckErrorCode =
  /** `done` needs the health event that completes it. */
  | "event_required"
  /** Only `done` carries an event. */
  | "event_not_allowed"
  | "event_not_found"
  /** The event is for someone else than the check's member. */
  | "event_member_mismatch"
  /** The event is not of the type the check asks for (a pain entry can't complete a BP check). */
  | "event_type_mismatch"
  /** The event already completes a different slot of this check. */
  | "event_already_used"
  /** Moving a log onto a slot that already has one. */
  | "slot_taken"
  /** Deleting the entry would also take away the completion of another check. */
  | "event_in_use";

export class RecordCheckError extends Error {
  constructor(public readonly code: RecordCheckErrorCode) {
    super(code);
    this.name = "RecordCheckError";
  }
}

/**
 * Slots are minute-aligned (`HH:MM` schedules, minute-multiple intervals), but a client may send
 * an ISO string with seconds or milliseconds (push action tokens, `new Date()`). Left alone, that
 * would create a second "12:00:07" slot beside the real 12:00 one, which the unique index
 * cannot catch. Truncate to the minute.
 */
export function normalizeSlotInstant(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000);
}

export interface RecordCheckInput {
  check: HealthCheckRow;
  /** null is valid: the column is nullable and "set null" on user delete. */
  loggedByUserId: string | null;
  status: CheckLogStatus;
  /** The slot being logged. Truncated to the minute. */
  scheduledAt: Date;
  loggedAt: Date;
  notes?: string | null;
  /**
   * The health event that completes the slot. Required for `done`, forbidden otherwise. A slot
   * counts as done however early or late the event is: the link is what matters, not the clock.
   */
  healthEventId?: string | null;
  source: CheckLogSource;
}

/**
 * The completing event has to be one that could really have completed this check: same
 * household, same person, same kind of entry, and not already spoken for by another slot of the
 * same check (one reading cannot tick two slots). One event *may* complete several different
 * checks (BP and weight in a single vitals entry), so there is no uniqueness rule across checks.
 */
async function assertEventCompletesCheck(
  db: Database,
  check: HealthCheckRow,
  scheduledAt: Date,
  eventId: string,
  /** The log being edited: it may still hold the old slot, and must not count against itself. */
  excludeLogId?: string,
): Promise<void> {
  const [event] = await db
    .select({ memberId: healthEvents.memberId, type: healthEvents.type })
    .from(healthEvents)
    .where(and(eq(healthEvents.id, eventId), eq(healthEvents.householdId, check.householdId)))
    .limit(1);
  if (!event) throw new RecordCheckError("event_not_found");
  if (event.memberId !== check.memberId) throw new RecordCheckError("event_member_mismatch");
  if (event.type !== check.eventType) throw new RecordCheckError("event_type_mismatch");

  const [usedElsewhere] = await db
    .select({ id: healthCheckLogs.id })
    .from(healthCheckLogs)
    .where(
      and(
        eq(healthCheckLogs.checkId, check.id),
        eq(healthCheckLogs.healthEventId, eventId),
        ne(healthCheckLogs.scheduledAt, scheduledAt),
        excludeLogId ? ne(healthCheckLogs.id, excludeLogId) : undefined,
      ),
    )
    .limit(1);
  if (usedElsewhere) throw new RecordCheckError("event_already_used");
}

/**
 * The one and only writer of `health_check_logs`. Every path that records a check slot (log from
 * the check, skip, a future group action or push action) goes through here, so "which one wins"
 * has exactly one answer. Mirrors `recordDose`.
 *
 * The conflict target is the unique index `health_check_logs_instant_unique` (migration 0085):
 * one row per `(check_id, scheduled_at)`. The DB, not a best-effort SELECT in application code, is
 * what guarantees it, even under a race.
 *
 * Unlike `recordDose` this never creates the health event: it links one that already exists. The
 * caller owns visibility / permission checks (this runs from routes and, later, the worker).
 */
export async function recordCheck(
  db: Database,
  env: Env,
  input: RecordCheckInput,
): Promise<{
  log: ReturnType<typeof serializeHealthCheckLog>;
  outcome: RecordCheckOutcome;
}> {
  const { check, status, loggedAt, loggedByUserId, source } = input;
  const scheduledAt = normalizeSlotInstant(input.scheduledAt);
  const eventId = input.healthEventId ?? null;

  if (status === "done" && !eventId) throw new RecordCheckError("event_required");
  if (status !== "done" && eventId) throw new RecordCheckError("event_not_allowed");

  const [existing] = await db
    .select()
    .from(healthCheckLogs)
    .where(and(eq(healthCheckLogs.checkId, check.id), eq(healthCheckLogs.scheduledAt, scheduledAt)))
    .limit(1);

  // A group "fill the gaps" action never touches a slot that already has an answer, so there is
  // nothing to validate or write.
  if (existing && source === "bulk") {
    return { log: serializeHealthCheckLog(existing, env), outcome: "unchanged" };
  }

  if (eventId) await assertEventCompletesCheck(db, check, scheduledAt, eventId);

  const notesEnc = input.notes ? encryptHealthField(input.notes, env) : null;
  const values = { status, loggedAt, loggedByUserId, notes: notesEnc, healthEventId: eventId };

  if (existing) {
    const [row] = await db
      .update(healthCheckLogs)
      .set(values)
      .where(eq(healthCheckLogs.id, existing.id))
      .returning();
    return { log: serializeHealthCheckLog(row, env), outcome: "updated" };
  }

  if (source === "bulk") {
    const inserted = await db
      .insert(healthCheckLogs)
      .values({ checkId: check.id, scheduledAt, ...values })
      .onConflictDoNothing({ target: [healthCheckLogs.checkId, healthCheckLogs.scheduledAt] })
      .returning();
    if (inserted.length === 0) {
      // Lost the race to another writer between the SELECT above and here.
      const [winner] = await db
        .select()
        .from(healthCheckLogs)
        .where(and(eq(healthCheckLogs.checkId, check.id), eq(healthCheckLogs.scheduledAt, scheduledAt)))
        .limit(1);
      return { log: serializeHealthCheckLog(winner!, env), outcome: "unchanged" };
    }
    return { log: serializeHealthCheckLog(inserted[0]!, env), outcome: "inserted" };
  }

  // single, no existing row. onConflictDoUpdate is the race backstop: if another writer got in
  // first, this still wins ("last single action wins").
  const [row] = await db
    .insert(healthCheckLogs)
    .values({ checkId: check.id, scheduledAt, ...values })
    .onConflictDoUpdate({
      target: [healthCheckLogs.checkId, healthCheckLogs.scheduledAt],
      set: values,
    })
    .returning();
  return { log: serializeHealthCheckLog(row!, env), outcome: "inserted" };
}

export interface EditCheckLogInput {
  check: HealthCheckRow;
  log: HealthCheckLogRow;
  loggedByUserId: string | null;
  now: Date;
  patch: {
    /** `missed` is system-only and cannot be set here; an existing `missed` log can be changed. */
    status?: "done" | "skipped";
    /** The completing entry. Only for `done`; `null` clears it (which a `done` slot cannot do). */
    healthEventId?: string | null;
    notes?: string | null;
    /** Move the log to a different slot of the same check. Truncated to the minute. */
    scheduledAt?: Date;
  };
}

/**
 * Change an existing log: done <-> skipped, swap the linked entry, move it to another slot, or
 * edit its note. Same writer, same rules as {@link recordCheck}: a `done` slot needs an entry
 * that could complete the check, only `done` carries one, and an entry completes one slot per
 * check. The entry itself is never touched: going to `skipped` unlinks it but leaves it alone.
 *
 * The reading's *time* is not a property of the log; it is on the entry (`PATCH /events/:id`).
 */
export async function editCheckLog(
  db: Database,
  env: Env,
  input: EditCheckLogInput,
): Promise<{ log: ReturnType<typeof serializeHealthCheckLog>; outcome: "updated" | "unchanged" }> {
  const { check, log, patch } = input;

  const status = patch.status ?? log.status;
  const slot = patch.scheduledAt ? normalizeSlotInstant(patch.scheduledAt) : log.scheduledAt;

  let eventId: string | null;
  if (status !== "done") {
    if (patch.healthEventId) throw new RecordCheckError("event_not_allowed");
    eventId = null;
  } else {
    eventId = patch.healthEventId !== undefined ? patch.healthEventId : log.healthEventId;
    if (!eventId) throw new RecordCheckError("event_required");
  }

  const slotMoved = slot.getTime() !== log.scheduledAt.getTime();
  const answerChanged = status !== log.status || eventId !== log.healthEventId || slotMoved;
  if (!answerChanged && patch.notes === undefined) {
    return { log: serializeHealthCheckLog(log, env), outcome: "unchanged" };
  }

  if (slotMoved) {
    const [occupied] = await db
      .select({ id: healthCheckLogs.id })
      .from(healthCheckLogs)
      .where(and(eq(healthCheckLogs.checkId, check.id), eq(healthCheckLogs.scheduledAt, slot)))
      .limit(1);
    if (occupied) throw new RecordCheckError("slot_taken");
  }
  if (eventId && (eventId !== log.healthEventId || slotMoved)) {
    await assertEventCompletesCheck(db, check, slot, eventId, log.id);
  }

  const values: Partial<typeof healthCheckLogs.$inferInsert> = { status, scheduledAt: slot, healthEventId: eventId };
  if (patch.notes !== undefined) values.notes = patch.notes ? encryptHealthField(patch.notes, env) : null;
  // A changed answer is a fresh decision by whoever made it; a note-only edit is not.
  if (answerChanged) {
    values.loggedAt = input.now;
    values.loggedByUserId = input.loggedByUserId;
  }

  try {
    const [row] = await db.update(healthCheckLogs).set(values).where(eq(healthCheckLogs.id, log.id)).returning();
    return { log: serializeHealthCheckLog(row!, env), outcome: "updated" };
  } catch (e) {
    // Another writer took the target slot between the check above and the update.
    if (isUniqueViolationError(e)) throw new RecordCheckError("slot_taken");
    throw e;
  }
}

/**
 * Undo a slot: delete its log, so the slot reads open again. The linked entry is the person's
 * actual reading and stays unless `deleteEvent` is set, and it can't be deleted while it also
 * completes another check (that check would silently lose its completion). Checked before
 * anything is written. Returns whether the entry was deleted.
 *
 * The caller is responsible for deciding the user may delete the entry.
 */
export async function deleteCheckLog(
  db: Database,
  input: { log: HealthCheckLogRow; deleteEvent: boolean },
): Promise<{ deletedEvent: boolean }> {
  const eventId = input.log.healthEventId;
  const deleteEvent = input.deleteEvent && eventId != null;

  if (deleteEvent) {
    const [other] = await db
      .select({ id: healthCheckLogs.id })
      .from(healthCheckLogs)
      .where(and(eq(healthCheckLogs.healthEventId, eventId!), ne(healthCheckLogs.id, input.log.id)))
      .limit(1);
    if (other) throw new RecordCheckError("event_in_use");
  }

  await db.delete(healthCheckLogs).where(eq(healthCheckLogs.id, input.log.id));
  if (deleteEvent) await db.delete(healthEvents).where(eq(healthEvents.id, eventId!));
  return { deletedEvent: deleteEvent };
}

/**
 * An entry that completes slots stops doing so when it is deleted, or re-typed / handed to someone
 * else (it would no longer be the right kind of entry for the right person). Remove those
 * completions so the slots read open again instead of `done` with nothing behind them. Returns how
 * many were removed.
 */
export async function unlinkCheckLogsForEvent(db: Database, eventId: string): Promise<number> {
  const removed = await db
    .delete(healthCheckLogs)
    .where(eq(healthCheckLogs.healthEventId, eventId))
    .returning({ id: healthCheckLogs.id });
  return removed.length;
}
