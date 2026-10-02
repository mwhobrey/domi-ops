import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@domi-ops/db";
import { healthMedicationPauses } from "@domi-ops/db";
import type { PausePeriod } from "@domi-ops/calendar-sync";

// The pure pause math is shared with health checks (WHO-384), so it lives in calendar-sync.
export { excludeInactiveInstants } from "@domi-ops/calendar-sync";

export type MedPausePeriod = PausePeriod;

/**
 * Record an `enabled` flip as a pause period (WHO-338). Pausing opens a period; resuming closes
 * every open one. No-op when the flag didn't change.
 */
export async function recordMedicationEnabledChange(
  db: Database,
  medicationId: string,
  wasEnabled: boolean,
  nowEnabled: boolean,
  at: Date = new Date(),
): Promise<void> {
  if (wasEnabled === nowEnabled) return;
  if (!nowEnabled) {
    await db.insert(healthMedicationPauses).values({ medicationId, pausedAt: at });
    return;
  }
  await db
    .update(healthMedicationPauses)
    .set({ resumedAt: at })
    .where(and(eq(healthMedicationPauses.medicationId, medicationId), isNull(healthMedicationPauses.resumedAt)));
}

export async function loadMedicationPausesMap(
  db: Database,
  medicationIds: string[],
): Promise<Map<string, MedPausePeriod[]>> {
  const map = new Map<string, MedPausePeriod[]>();
  if (medicationIds.length === 0) return map;
  const rows = await db
    .select()
    .from(healthMedicationPauses)
    .where(inArray(healthMedicationPauses.medicationId, medicationIds));
  for (const row of rows) {
    const list = map.get(row.medicationId) ?? [];
    list.push({ pausedAt: row.pausedAt, resumedAt: row.resumedAt });
    map.set(row.medicationId, list);
  }
  return map;
}
