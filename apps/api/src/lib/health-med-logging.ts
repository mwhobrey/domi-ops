import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { healthEvents, healthMedicationLogs, healthMedications } from "@domi-ops/db";
import { decryptHealthFieldOrPassthrough, encryptHealthField } from "./health-crypto.js";
import { loadHealthMedicationShareMap, replaceHealthEventShares } from "./health-access.js";
import { serializeHealthLog } from "./health-serialize.js";

type HealthMedicationRow = typeof healthMedications.$inferSelect;

/**
 * Shared core of "log one dose" — everything after the caller's own ACL/validation checks.
 * Used by both POST /medications/:id/log (single medication) and the medication-group "take
 * all" / push-action routes (looped once per member medication), so the actual insert logic
 * only lives in one place.
 */
export async function logMedicationDose(
  db: Database,
  env: Env,
  input: {
    med: HealthMedicationRow;
    householdId: string;
    loggedByUserId: string;
    status: "taken" | "skipped" | "missed";
    scheduledAt: Date | null;
    loggedAt: Date;
    notes?: string;
    alsoCreateEvent?: boolean;
  },
): Promise<{ log: ReturnType<typeof serializeHealthLog>; healthEventId: string | null }> {
  const { med, loggedByUserId, status, scheduledAt, loggedAt, notes, alsoCreateEvent } = input;

  let healthEventId: string | null = null;
  if (alsoCreateEvent && status === "taken") {
    const medName = decryptHealthFieldOrPassthrough(med.name, env) ?? "medication";
    const title = encryptHealthField(`Took ${medName}`, env)!;
    const notesEnc = notes ? encryptHealthField(notes, env) : null;
    const [eventRow] = await db
      .insert(healthEvents)
      .values({
        householdId: input.householdId,
        memberId: med.memberId,
        medicationId: med.id,
        type: "medication",
        title,
        notes: notesEnc,
        startedAt: loggedAt,
        visibility: med.visibility,
        createdByUserId: loggedByUserId,
      })
      .returning();
    healthEventId = eventRow.id;
    if (med.visibility === "private") {
      const shares = await loadHealthMedicationShareMap(db, [med.id]);
      await replaceHealthEventShares(db, eventRow.id, shares.get(med.id) ?? []);
    }
  }

  const [logRow] = await db
    .insert(healthMedicationLogs)
    .values({
      medicationId: med.id,
      scheduledAt,
      status,
      loggedAt,
      loggedByUserId,
      notes: notes ? encryptHealthField(notes, env) : null,
      healthEventId,
    })
    .returning();

  return { log: serializeHealthLog(logRow, env), healthEventId };
}
