import {
  addDaysUtc,
  bridgeDoseFreeDays,
  computeSupply,
  effectiveLeadDays,
  estimateNeedsConfirmation,
  daysRemaining,
  organizerCoverage,
  pillDoseSchedule,
  quartersToDays,
  refillStatus,
  type DateRange,
  type OrganizerGroup,
  type PillDoseSchedule,
} from "@domi-ops/calendar-sync";
import {
  healthMedicationGroupMembers,
  healthMedicationGroups,
  healthMedicationPauses,
  healthMedicationSupply,
  healthMedicationSupplyRevisions,
  healthMedications,
  healthOrganizerSessionFills,
  healthPharmacies,
  healthSupplySettings,
  type Database,
} from "@domi-ops/db";
import type { Env } from "@domi-ops/config";
import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { decryptHealthFieldOrPassthrough } from "./health-crypto.js";
import { loadDoseQuantities } from "./health-dose-quantities.js";
import { quartersToPills } from "./health-supply-validation.js";
import { householdTodayIsoDate } from "./household-time.js";

/**
 * The supply and pharmacy summaries that ride along on medication responses (WHO-419), and the
 * organizer coverage the estimate is added to. Everything shown is derived on read from the stored
 * estimate, so "days remaining" is for today and never goes stale in the database.
 */

export type SupplySummary = {
  /** First date without supply, or null when only a pharmacy or lead time has been set. */
  runsOutOn: string | null;
  estimatedOn: string | null;
  daysRemaining: number | null;
  outsideDays: number | null;
  /** The pill count the person last gave; null when the estimate was entered in days. */
  outsidePills: number | null;
  organizerDaysCounted: number | null;
  revision: number;
  /** Send this back when changing the supply; a stale one is refused instead of overwriting. */
  version: number;
  /** The lead time in effect, and the medication's own choice when it has one. */
  leadDays: number;
  leadDaysOverride: number | null;
  state: ReturnType<typeof refillStatus>["state"];
  deadline: string | null;
  overdue: boolean;
  requestedAt: string | null;
  receivedAt: string | null;
  /** Resumed since the estimate was made: confirm or replace it before relying on it. */
  needsConfirmation: boolean;
};

export type PharmacySummary = { id: string; name: string; archived: boolean };

export type SupplyView = { supply: SupplySummary; pharmacy: PharmacySummary | null };

type MedicationFacts = { id: string; memberId: string; enabled: boolean; deletedAt: Date | null; endDate: string | null };

export type SupplyContext = {
  today: string;
  pharmacies: Map<string, PharmacySummary>;
  personDefaults: Map<string, number>;
  /** When each medication's latest estimate was recorded. */
  estimateMadeAt: Map<string, Date>;
  pauses: Map<string, Array<{ pausedAt: Date; resumedAt: Date | null }>>;
};

/** Builds one medication's summary from its stored row, as of `ctx.today`. */
export function buildSupplyView(
  med: MedicationFacts,
  row: typeof healthMedicationSupply.$inferSelect,
  ctx: SupplyContext,
): SupplyView {
  const lead = effectiveLeadDays(row.leadDays, ctx.personDefaults.get(med.memberId));
  const status = refillStatus({
    today: ctx.today,
    runsOutOn: row.runsOutOn,
    leadDays: lead,
    medicationEndDate: med.endDate,
    active: med.enabled && med.deletedAt === null,
    requested: row.requestedAt !== null,
  });
  const madeAt = ctx.estimateMadeAt.get(med.id);
  return {
    supply: {
      runsOutOn: row.runsOutOn,
      estimatedOn: row.estimatedOn,
      daysRemaining: row.runsOutOn ? daysRemaining(row.runsOutOn, ctx.today) : null,
      outsideDays: row.outsideDays,
      outsidePills: row.outsideQuarters === null ? null : quartersToPills(row.outsideQuarters),
      organizerDaysCounted: row.organizerDaysCounted,
      revision: row.revision,
      version: row.version,
      leadDays: lead,
      leadDaysOverride: row.leadDays,
      state: status.state,
      deadline: status.deadline,
      overdue: status.overdue,
      requestedAt: row.requestedAt?.toISOString() ?? null,
      receivedAt: row.receivedAt?.toISOString() ?? null,
      needsConfirmation: row.runsOutOn !== null && madeAt !== undefined && estimateNeedsConfirmation(madeAt, ctx.pauses.get(med.id) ?? []),
    },
    pharmacy: row.pharmacyId ? (ctx.pharmacies.get(row.pharmacyId) ?? null) : null,
  };
}

/** Everything `buildSupplyView` needs for these medications, in a handful of queries. */
export async function loadSupplyViews(
  db: Database,
  env: Env,
  householdId: string,
  meds: readonly MedicationFacts[],
): Promise<Map<string, SupplyView>> {
  const out = new Map<string, SupplyView>();
  if (meds.length === 0) return out;
  const ids = meds.map((m) => m.id);
  const rows = await db.select().from(healthMedicationSupply).where(inArray(healthMedicationSupply.medicationId, ids));
  if (rows.length === 0) return out;

  const withEstimate = rows.filter((r) => r.runsOutOn !== null).map((r) => r.medicationId);
  const pharmacyIds = [...new Set(rows.map((r) => r.pharmacyId).filter((id): id is string => id !== null))];
  const memberIds = [...new Set(meds.map((m) => m.memberId))];

  const [today, pharmacyRows, settingRows, madeRows, pauseRows] = await Promise.all([
    householdTodayIsoDate(db, householdId),
    pharmacyIds.length
      ? db.select({ id: healthPharmacies.id, name: healthPharmacies.name, archivedAt: healthPharmacies.archivedAt }).from(healthPharmacies).where(inArray(healthPharmacies.id, pharmacyIds))
      : Promise.resolve([]),
    db.select({ memberId: healthSupplySettings.memberId, days: healthSupplySettings.defaultLeadDays }).from(healthSupplySettings).where(inArray(healthSupplySettings.memberId, memberIds)),
    withEstimate.length
      ? db
          .select({ medicationId: healthMedicationSupplyRevisions.medicationId, at: max(healthMedicationSupplyRevisions.createdAt) })
          .from(healthMedicationSupplyRevisions)
          .where(inArray(healthMedicationSupplyRevisions.medicationId, withEstimate))
          .groupBy(healthMedicationSupplyRevisions.medicationId)
      : Promise.resolve([]),
    withEstimate.length
      ? db.select().from(healthMedicationPauses).where(inArray(healthMedicationPauses.medicationId, withEstimate))
      : Promise.resolve([]),
  ]);

  const ctx: SupplyContext = {
    today,
    pharmacies: new Map(
      pharmacyRows.map((p) => [p.id, { id: p.id, name: decryptHealthFieldOrPassthrough(p.name, env) ?? "", archived: p.archivedAt !== null }]),
    ),
    personDefaults: new Map(settingRows.map((s) => [s.memberId, s.days])),
    estimateMadeAt: new Map(madeRows.filter((r) => r.at !== null).map((r) => [r.medicationId, r.at as Date])),
    pauses: new Map(),
  };
  for (const p of pauseRows) {
    const list = ctx.pauses.get(p.medicationId) ?? [];
    list.push({ pausedAt: p.pausedAt, resumedAt: p.resumedAt });
    ctx.pauses.set(p.medicationId, list);
  }

  const byId = new Map(meds.map((m) => [m.id, m]));
  for (const row of rows) {
    const med = byId.get(row.medicationId);
    if (med) out.set(med.id, buildSupplyView(med, row, ctx));
  }
  return out;
}

/** The additive fields a medication response gains; empty when nothing about supply was ever set. */
export function supplyExtras(view: SupplyView | undefined): { supply?: SupplySummary; pharmacy?: PharmacySummary | null } {
  return view ? { supply: view.supply, pharmacy: view.pharmacy } : {};
}

export type Estimate = {
  runsOutOn: string;
  outsideDays: number;
  /** The count behind `outsideDays`, in quarters of a pill, when one was given. */
  outsideQuarters: number | null;
  organizerDays: number;
  totalDays: number;
  confirmed: boolean;
};

export type EstimateOutcome =
  | { kind: "ok"; estimate: Estimate }
  /** A gap in the organizers: the caller must send the total they have in hand. */
  | { kind: "needs_confirmation"; organizerDays: number; organizerEndsOn: string | null }
  | { kind: "too_large" }
  /** Pills were given for a medication with no fixed dose to turn them into days with. */
  | { kind: "no_fixed_dose" };

/**
 * The medications that have a fixed pill dose, and what it is on any day, from their own schedule, quantities and groups.
 * A medication with no entry here keeps its supply in days. Every group counts, seen by the viewer or not, the same as a
 * filling session: the pills are used whoever can see the group.
 */
export async function loadPillSchedules(db: Database, medicationIds: readonly string[]): Promise<Map<string, PillDoseSchedule>> {
  const out = new Map<string, PillDoseSchedule>();
  if (medicationIds.length === 0) return out;
  const ids = [...medicationIds];
  const [meds, memberships, quantities] = await Promise.all([
    db.select().from(healthMedications).where(inArray(healthMedications.id, ids)),
    db.select().from(healthMedicationGroupMembers).where(inArray(healthMedicationGroupMembers.medicationId, ids)),
    loadDoseQuantities(db, ids),
  ]);
  const groupIds = [...new Set(memberships.map((m) => m.groupId))];
  const groupRows = groupIds.length ? await db.select().from(healthMedicationGroups).where(inArray(healthMedicationGroups.id, groupIds)) : [];
  const groups: OrganizerGroup[] = groupRows
    .filter((g) => g.scheduleKind === "scheduled" || g.scheduleKind === "interval")
    .map((g) => ({
      id: g.id,
      scheduleKind: g.scheduleKind as "scheduled" | "interval",
      scheduleJson: g.scheduleJson,
      startDate: g.startDate,
      endDate: g.endDate,
      enabled: g.enabled,
      medicationIds: memberships.filter((m) => m.groupId === g.id).map((m) => m.medicationId),
    }));
  for (const med of meds) {
    const schedule = pillDoseSchedule(med, groups, quantities.get(med.id));
    if (schedule) out.set(med.id, schedule);
  }
  return out;
}

/**
 * What the outside supply (plus the organizers' unbroken coverage from `today`) comes to. Writes nothing. A pill count is
 * turned into days here and only here: the pills outside are used once the organizers run out, so the walk starts then.
 */
export async function computeEstimate(
  db: Database,
  medicationId: string,
  today: string,
  input: { outsideDays?: number; outsideQuarters?: number; confirmedTotalDays?: number },
  /** Stretches about to be recorded, counted as if they already were, so a refused change leaves nothing behind. */
  extraRanges: readonly DateRange[] = [],
): Promise<EstimateOutcome> {
  const filled = [...(await loadOrganizerRanges(db, medicationId)), ...extraRanges];
  const schedule = (await loadPillSchedules(db, [medicationId])).get(medicationId);
  const ranges = schedule ? bridgeDoseFreeDays(filled, schedule, today) : filled;
  let result;
  try {
    let outsideDays = input.outsideDays;
    if (input.outsideQuarters !== undefined) {
      if (!schedule) return { kind: "no_fixed_dose" };
      outsideDays = quartersToDays(schedule, addDaysUtc(today, organizerCoverage(ranges, today).days), input.outsideQuarters);
    }
    if (outsideDays === undefined) throw new Error("computeEstimate needs outsideDays or outsideQuarters");
    result = computeSupply({ today, ranges, outsideDays, confirmedTotalDays: input.confirmedTotalDays });
  } catch (e) {
    if (e instanceof RangeError) return { kind: "too_large" };
    throw e;
  }
  if (result.needsConfirmation) {
    return { kind: "needs_confirmation", organizerDays: result.organizerDays, organizerEndsOn: result.organizerEndsOn };
  }
  return {
    kind: "ok",
    estimate: {
      runsOutOn: result.runsOutOn,
      outsideDays: result.outsideDays,
      outsideQuarters: input.outsideQuarters ?? null,
      organizerDays: result.organizerDays,
      totalDays: result.totalDays,
      confirmed: result.confirmed,
    },
  };
}

/** The days an organizer was filled for this medication, across every session, undone fills left out. */
export async function loadOrganizerRanges(db: Database, medicationId: string): Promise<DateRange[]> {
  const rows = await db
    .select({ from: healthOrganizerSessionFills.coveredFrom, to: healthOrganizerSessionFills.coveredTo })
    .from(healthOrganizerSessionFills)
    .where(and(eq(healthOrganizerSessionFills.medicationId, medicationId), isNull(healthOrganizerSessionFills.undoneAt)));
  return rows.map((r) => ({ from: r.from, to: r.to }));
}
