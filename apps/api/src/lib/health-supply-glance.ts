import type { Env } from "@domi-ops/config";
import { healthMedications, type Database } from "@domi-ops/db";
import { and, eq, isNull } from "drizzle-orm";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";
import { healthMedicationVisibleWhere } from "./health-access.js";
import { loadSupplyViews } from "./health-supply.js";

export type RefillDue = {
  medicationId: string;
  memberId: string;
  name: string;
  runsOutOn: string;
  daysRemaining: number | null;
  /** The deadline has passed. */
  overdue: boolean;
};

/**
 * The dashboard Health tile's refills (WHO-431): medications the viewer can see whose refill deadline has come and
 * that nobody has asked the pharmacy for yet, soonest to run out first. A requested refill is waiting, not due.
 */
export async function loadRefillsDue(
  db: Database,
  env: Env,
  auth: { householdId: string; userId: string; memberId: string; role: string },
): Promise<RefillDue[]> {
  const meds = await db
    .select()
    .from(healthMedications)
    .where(and(healthMedicationVisibleWhere(db, auth), eq(healthMedications.enabled, true), isNull(healthMedications.deletedAt)));
  const views = await loadSupplyViews(db, env, auth.householdId, meds);
  const due: RefillDue[] = [];
  for (const med of meds) {
    const supply = views.get(med.id)?.supply;
    if (!supply || supply.state !== "needs_refill" || !supply.runsOutOn) continue;
    due.push({
      medicationId: med.id,
      memberId: med.memberId,
      name: decryptHealthFieldOrPassthrough(med.name, env) ?? "Medication",
      runsOutOn: supply.runsOutOn,
      daysRemaining: supply.daysRemaining,
      overdue: supply.overdue,
    });
  }
  return due.sort((a, b) => a.runsOutOn.localeCompare(b.runsOutOn) || a.name.localeCompare(b.name));
}
