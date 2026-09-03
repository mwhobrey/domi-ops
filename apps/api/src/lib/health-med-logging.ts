import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { healthEvents, healthMedicationLogs, healthMedications } from "@domi-ops/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { decryptHealthFieldOrPassthrough, encryptHealthField } from "./health-crypto.js";
import { loadHealthMedicationShareMap, replaceHealthEventShares } from "./health-access.js";
import { serializeHealthLog } from "./health-serialize.js";

type HealthMedicationRow = typeof healthMedications.$inferSelect;

/**
 * Who's asking to log this dose. Decides what happens when a log already exists for the same
 * `(medicationId, scheduledAt)`:
 *
 * - `"single"` — an individual action on one dose: the Taken/Skip buttons, or a per-med push
 *   notification button. The person is deciding about this exact dose, so it **overrides** any
 *   prior log for that instant. Tap Skip then Taken and it flips.
 * - `"bulk"` — a group / "take all" action touching several meds at once: the group card's
 *   "Take all", the consolidated group push button, the ad-hoc same-time batch. It only **fills
 *   gaps** — a dose already logged (taken *or* skipped) is left exactly as it was.
 */
export type DoseLogSource = "single" | "bulk";

export type RecordDoseOutcome = "inserted" | "updated" | "unchanged";

export interface RecordDoseInput {
  med: HealthMedicationRow;
  householdId: string;
  loggedByUserId: string;
  status: "taken" | "skipped" | "missed";
  /** null for PRN — every PRN take is its own row, no dedup. */
  scheduledAt: Date | null;
  loggedAt: Date;
  notes?: string | null;
  source: DoseLogSource;
  /** Create a "Took <med>" health event alongside the log. Only fires when a row is inserted. */
  alsoCreateEvent?: boolean;
}

async function createTakenEvent(db: Database, env: Env, input: RecordDoseInput): Promise<string> {
  const { med } = input;
  const medName = decryptHealthFieldOrPassthrough(med.name, env) ?? "medication";
  const [eventRow] = await db
    .insert(healthEvents)
    .values({
      householdId: input.householdId,
      memberId: med.memberId,
      medicationId: med.id,
      type: "medication",
      title: encryptHealthField(`Took ${medName}`, env)!,
      notes: input.notes ? encryptHealthField(input.notes, env) : null,
      startedAt: input.loggedAt,
      visibility: med.visibility,
      createdByUserId: input.loggedByUserId,
    })
    .returning();
  if (med.visibility === "private") {
    const shares = await loadHealthMedicationShareMap(db, [med.id]);
    await replaceHealthEventShares(db, eventRow.id, shares.get(med.id) ?? []);
  }
  return eventRow.id;
}

/**
 * The one and only writer of `health_medication_logs`. Every path that records a dose
 * (individual log, per-med push action, group "take all", group push action, the ad-hoc
 * same-time batch) goes through here, so "which one wins" has exactly one answer.
 *
 * The conflict target is the partial unique index `health_medication_logs_instant_unique`
 * (migration 0065): one row per `(medication_id, scheduled_at)` where `scheduled_at` is set. The
 * DB, not a best-effort SELECT in application code, is what guarantees it — even under a race.
 */
export async function recordDose(
  db: Database,
  env: Env,
  input: RecordDoseInput,
): Promise<{
  log: ReturnType<typeof serializeHealthLog>;
  healthEventId: string | null;
  outcome: RecordDoseOutcome;
}> {
  const { med, status, scheduledAt, loggedAt, loggedByUserId, source } = input;
  const notesEnc = input.notes ? encryptHealthField(input.notes, env) : null;
  const wantsEvent = (input.alsoCreateEvent ?? false) && status === "taken";

  // PRN (no scheduledAt): not covered by the unique index, always its own row.
  if (scheduledAt == null) {
    const healthEventId = wantsEvent ? await createTakenEvent(db, env, input) : null;
    const [row] = await db
      .insert(healthMedicationLogs)
      .values({ medicationId: med.id, scheduledAt: null, status, loggedAt, loggedByUserId, notes: notesEnc, healthEventId })
      .returning();
    return { log: serializeHealthLog(row, env), healthEventId, outcome: "inserted" };
  }

  const [existing] = await db
    .select()
    .from(healthMedicationLogs)
    .where(and(eq(healthMedicationLogs.medicationId, med.id), eq(healthMedicationLogs.scheduledAt, scheduledAt)))
    .limit(1);

  if (existing) {
    if (source === "bulk") {
      return { log: serializeHealthLog(existing, env), healthEventId: existing.healthEventId, outcome: "unchanged" };
    }
    const [row] = await db
      .update(healthMedicationLogs)
      .set({ status, loggedAt, loggedByUserId, notes: notesEnc })
      .where(eq(healthMedicationLogs.id, existing.id))
      .returning();
    return { log: serializeHealthLog(row, env), healthEventId: row.healthEventId, outcome: "updated" };
  }

  if (source === "bulk") {
    const inserted = await db
      .insert(healthMedicationLogs)
      .values({ medicationId: med.id, scheduledAt, status, loggedAt, loggedByUserId, notes: notesEnc })
      .onConflictDoNothing({
        target: [healthMedicationLogs.medicationId, healthMedicationLogs.scheduledAt],
        where: isNotNull(healthMedicationLogs.scheduledAt),
      })
      .returning();
    if (inserted.length === 0) {
      // Lost the race to another writer between the SELECT above and here.
      const [winner] = await db
        .select()
        .from(healthMedicationLogs)
        .where(and(eq(healthMedicationLogs.medicationId, med.id), eq(healthMedicationLogs.scheduledAt, scheduledAt)))
        .limit(1);
      return { log: serializeHealthLog(winner, env), healthEventId: winner.healthEventId, outcome: "unchanged" };
    }
    const healthEventId = wantsEvent ? await createTakenEvent(db, env, input) : null;
    if (healthEventId) {
      await db.update(healthMedicationLogs).set({ healthEventId }).where(eq(healthMedicationLogs.id, inserted[0].id));
    }
    return { log: serializeHealthLog({ ...inserted[0], healthEventId }, env), healthEventId, outcome: "inserted" };
  }

  // single, no existing row. onConflictDoUpdate is the race backstop — if another writer got
  // in first, this still wins ("last single action wins"). A redundant "Took <med>" event is
  // possible under that exact race and is harmless; the current UI only sets alsoCreateEvent
  // for PRN anyway (handled above), so this is a dead branch in practice.
  const healthEventId = wantsEvent ? await createTakenEvent(db, env, input) : null;
  const [row] = await db
    .insert(healthMedicationLogs)
    .values({ medicationId: med.id, scheduledAt, status, loggedAt, loggedByUserId, notes: notesEnc, healthEventId })
    .onConflictDoUpdate({
      target: [healthMedicationLogs.medicationId, healthMedicationLogs.scheduledAt],
      targetWhere: isNotNull(healthMedicationLogs.scheduledAt),
      set: { status, loggedAt, loggedByUserId, notes: notesEnc },
    })
    .returning();
  return { log: serializeHealthLog(row, env), healthEventId: row.healthEventId, outcome: "inserted" };
}
