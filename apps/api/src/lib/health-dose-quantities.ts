import { healthMedicationDoseQuantities, type Database } from "@domi-ops/db";
import { eq, inArray } from "drizzle-orm";
import { parseFixedTimeSchedule, scheduleHhmm } from "@domi-ops/calendar-sync";
import {
  SupplyValidationError,
  normalizeDoseTime,
  parsePillQuantity,
  quartersToPills,
} from "./health-supply-validation.js";

/**
 * Pills per scheduled dose time for a medication (WHO-417), for the pill organizer. Stored as whole
 * quarters of a pill, spoken on the API as a number of pills (1.5). Never inferred from the dosage
 * text.
 */

/** HH:MM to whole quarters of a pill. */
export type DoseQuantities = Map<string, number>;

/** A schedule has at most this many times (see MAX_CHECK_TIMES), so a quantity list cannot be longer. */
const MAX_QUANTITY_ENTRIES = 48;

/**
 * Read `{ "08:00": 1.5, "21:00": 1 }` from a request body. Keys are normalised to HH:MM (so "08:00:00"
 * and "08:00" are the same time, and giving both is an error), values must be quarter-step pill counts.
 * Not an object, or a list, is an error. Throws {@link SupplyValidationError}.
 */
export function parseDoseQuantities(raw: unknown): DoseQuantities {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new SupplyValidationError("invalid_dose_quantities");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_QUANTITY_ENTRIES) throw new SupplyValidationError("too_many_dose_quantities");
  const out: DoseQuantities = new Map();
  for (const [key, value] of entries) {
    const time = normalizeDoseTime(key);
    if (out.has(time)) throw new SupplyValidationError("duplicate_dose_time");
    out.set(time, parsePillQuantity(value));
  }
  return out;
}

/** The clock times a medication takes, as HH:MM, ordered. Only scheduled medications have any. */
export function scheduledTimes(scheduleKind: string, scheduleJson: string | null | undefined): string[] {
  if (scheduleKind !== "scheduled") return [];
  const times = (parseFixedTimeSchedule(scheduleJson).times ?? []).map(scheduleHhmm);
  return [...new Set(times)].sort();
}

/**
 * Quantities may only be set for times the medication actually takes, and only on a scheduled
 * medication. (Editing a schedule afterwards can still leave a quantity behind; that is reported by
 * {@link doseQuantityView}, not forbidden.) Throws {@link SupplyValidationError}.
 */
export function assertQuantitiesFitSchedule(
  quantities: DoseQuantities,
  scheduleKind: string,
  scheduleJson: string | null | undefined,
): void {
  if (quantities.size === 0) return;
  if (scheduleKind !== "scheduled") throw new SupplyValidationError("quantities_need_scheduled_medication");
  const times = new Set(scheduledTimes(scheduleKind, scheduleJson));
  for (const time of quantities.keys()) if (!times.has(time)) throw new SupplyValidationError("quantity_time_not_scheduled");
}

/** Postgres returns a `time` as "08:00:00". */
const hhmm = (time: string) => time.slice(0, 5);

/** medication id to its quantities, for any number of medications in one query. */
export async function loadDoseQuantities(db: Database, medicationIds: readonly string[]): Promise<Map<string, DoseQuantities>> {
  const out = new Map<string, DoseQuantities>();
  if (medicationIds.length === 0) return out;
  const rows = await db
    .select({
      medicationId: healthMedicationDoseQuantities.medicationId,
      doseTime: healthMedicationDoseQuantities.doseTime,
      quarters: healthMedicationDoseQuantities.quantityQuarters,
    })
    .from(healthMedicationDoseQuantities)
    .where(inArray(healthMedicationDoseQuantities.medicationId, [...medicationIds]));
  for (const row of rows) {
    const map = out.get(row.medicationId) ?? new Map<string, number>();
    map.set(hhmm(row.doseTime), row.quarters);
    out.set(row.medicationId, map);
  }
  return out;
}

/** Make the stored quantities for a medication exactly `quantities`; an empty map clears them. */
export async function replaceDoseQuantities(db: Database, medicationId: string, quantities: DoseQuantities): Promise<void> {
  await db.delete(healthMedicationDoseQuantities).where(eq(healthMedicationDoseQuantities.medicationId, medicationId));
  if (quantities.size === 0) return;
  await db.insert(healthMedicationDoseQuantities).values(
    [...quantities.entries()].map(([doseTime, quantityQuarters]) => ({ medicationId, doseTime, quantityQuarters })),
  );
}

export type DoseQuantityView = {
  /** HH:MM to a number of pills (1.5). */
  doseQuantities: Record<string, number>;
  /**
   * What a filling session must sort out before it can trust the numbers: scheduled times with no
   * quantity, and quantities for times the medication no longer takes (left behind by a schedule edit,
   * or from before it became as-needed).
   */
  doseQuantityIssues: { missing: string[]; orphaned: string[] };
};

/** The API's view of a medication's quantities, with the gaps called out. */
export function doseQuantityView(
  quantities: DoseQuantities | undefined,
  scheduleKind: string,
  scheduleJson: string | null | undefined,
): DoseQuantityView {
  const have = quantities ?? new Map<string, number>();
  const times = scheduledTimes(scheduleKind, scheduleJson);
  const timeSet = new Set(times);
  return {
    doseQuantities: Object.fromEntries([...have.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, q]) => [t, quartersToPills(q)])),
    doseQuantityIssues: {
      missing: times.filter((t) => !have.has(t)),
      orphaned: [...have.keys()].filter((t) => !timeSet.has(t)).sort(),
    },
  };
}
