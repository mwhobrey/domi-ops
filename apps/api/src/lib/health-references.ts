import {
  healthMedicationGroups,
  healthMedications,
  healthPharmacies,
  householdMembers,
  type Database,
} from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Every id a request names must belong to the caller's household (WHO-417).
 *
 * Row level security already hides other households' rows, so this is a second, explicit check that
 * turns "that row does not exist for you" into a clear answer instead of a foreign key error or, worse,
 * a write that silently references someone else's data. Each failure carries a stable `code` the route
 * turns into a 404; a malformed id gets the same answer as an unknown one, so ids cannot be probed.
 */
export type ReferenceCode =
  | "member_not_found"
  | "caregiver_not_found"
  | "medication_not_found"
  | "group_not_found"
  | "pharmacy_not_found";

export class ReferenceNotFoundError extends Error {
  constructor(public readonly code: ReferenceCode) {
    super(code);
    this.name = "ReferenceNotFoundError";
  }
}

export type References = {
  members?: readonly string[];
  /** Same table as members; a separate code so a bad caregiver reads as one. */
  caregivers?: readonly string[];
  medications?: readonly string[];
  groups?: readonly string[];
  pharmacies?: readonly string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function allExist(
  ids: readonly string[] | undefined,
  count: (unique: string[]) => Promise<number>,
  code: ReferenceCode,
): Promise<void> {
  if (!ids || ids.length === 0) return;
  const unique = [...new Set(ids)];
  if (unique.some((id) => typeof id !== "string" || !UUID.test(id))) throw new ReferenceNotFoundError(code);
  if ((await count(unique)) !== unique.length) throw new ReferenceNotFoundError(code);
}

/** Throws {@link ReferenceNotFoundError} for the first kind of id that is not all in the household. */
export async function requireInHousehold(db: Database, householdId: string, refs: References): Promise<void> {
  const members = (ids: string[]) =>
    db
      .select({ id: householdMembers.id })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), inArray(householdMembers.id, ids)))
      .then((r) => r.length);
  await allExist(refs.members, members, "member_not_found");
  await allExist(refs.caregivers, members, "caregiver_not_found");
  await allExist(
    refs.medications,
    (ids) =>
      db
        .select({ id: healthMedications.id })
        .from(healthMedications)
        .where(and(eq(healthMedications.householdId, householdId), inArray(healthMedications.id, ids)))
        .then((r) => r.length),
    "medication_not_found",
  );
  await allExist(
    refs.groups,
    (ids) =>
      db
        .select({ id: healthMedicationGroups.id })
        .from(healthMedicationGroups)
        .where(and(eq(healthMedicationGroups.householdId, householdId), inArray(healthMedicationGroups.id, ids)))
        .then((r) => r.length),
    "group_not_found",
  );
  await allExist(
    refs.pharmacies,
    (ids) =>
      db
        .select({ id: healthPharmacies.id })
        .from(healthPharmacies)
        .where(and(eq(healthPharmacies.householdId, householdId), inArray(healthPharmacies.id, ids)))
        .then((r) => r.length),
    "pharmacy_not_found",
  );
}
