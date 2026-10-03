import type { Database } from "@domi-ops/db";
import { healthChecks, healthMedicationGroups, healthMedications, households } from "@domi-ops/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { householdHasHealthModule } from "./health-reminder-shared.js";
import {
  enqueueForHouseholds,
  type EnqueueHouseholdScan,
  type HouseholdScanJob,
} from "./household-scan-fanout.js";

/** The tick side of the health reminder scans (WHO-403); see household-scan-fanout.ts. */
type Deps = { enqueue: EnqueueHouseholdScan; now?: Date };

/** Keep only households that have the health module on. */
async function withHealthModule(db: Database, candidateIds: string[]): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const rows = await db
    .select({ id: households.id, modulesEnabled: households.modulesEnabled })
    .from(households)
    .where(inArray(households.id, candidateIds));
  return rows.filter((h) => householdHasHealthModule(h.modulesEnabled)).map((h) => h.id);
}

async function fanOut(db: Database, job: HouseholdScanJob, candidateIds: string[], deps: Deps): Promise<number> {
  return enqueueForHouseholds(job, await withHealthModule(db, candidateIds), deps);
}

/** Households with at least one medication or medication group that can still send a reminder. */
export async function fanOutMedReminderScans(db: Database, deps: Deps): Promise<number> {
  const meds = await db
    .selectDistinct({ id: healthMedications.householdId })
    .from(healthMedications)
    .where(eq(healthMedications.enabled, true));
  const groups = await db
    .selectDistinct({ id: healthMedicationGroups.householdId })
    .from(healthMedicationGroups)
    .where(eq(healthMedicationGroups.enabled, true));
  return fanOut(db, "health.med.reminder.household", [...meds, ...groups].map((r) => r.id), deps);
}

/** Households with at least one health check that is on (not paused, not deleted). */
export async function fanOutCheckReminderScans(db: Database, deps: Deps): Promise<number> {
  const checks = await db
    .selectDistinct({ id: healthChecks.householdId })
    .from(healthChecks)
    .where(and(eq(healthChecks.enabled, true), isNull(healthChecks.deletedAt)));
  return fanOut(db, "health.check.reminder.household", checks.map((r) => r.id), deps);
}
