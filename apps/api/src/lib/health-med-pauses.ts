import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@domi-ops/db";
import { healthMedicationPauses } from "@domi-ops/db";

export interface MedPausePeriod {
  pausedAt: Date;
  resumedAt: Date | null;
}

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

/**
 * Drop scheduled dose instants that were never due: inside a pause, or at/after deletion.
 * Pure, so adherence math stays testable.
 */
export function excludeInactiveInstants(
  instants: Date[],
  pauses: MedPausePeriod[],
  deletedAt: Date | null,
): Date[] {
  return instants.filter((instant) => {
    const t = instant.getTime();
    if (deletedAt && t >= deletedAt.getTime()) return false;
    return !pauses.some(
      (p) => t >= p.pausedAt.getTime() && (p.resumedAt == null || t < p.resumedAt.getTime()),
    );
  });
}
