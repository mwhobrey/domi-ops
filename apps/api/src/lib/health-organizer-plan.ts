import { computePlacements, type OrganizerGroup, type OrganizerMedication, type PlacementProblem } from "@domi-ops/calendar-sync";
import {
  healthMedicationGroupMembers,
  healthMedicationGroups,
  healthMedications,
  healthOrganizerCompartments,
  healthOrganizerPlanCaregivers,
  healthOrganizerTimeMap,
  type Database,
  type healthOrganizerPlans,
} from "@domi-ops/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { healthMedicationGroupVisibleWhere, healthMedicationVisibleWhere } from "./health-access.js";
import { loadDoseQuantities } from "./health-dose-quantities.js";
import { householdTodayIsoDate } from "./household-time.js";

/**
 * What an organizer plan looks like on the API (WHO-424): the plan, its compartments, which compartment
 * each dose time goes in, who is reminded, and what is still missing before guided filling can work.
 */

export type PlanRow = typeof healthOrganizerPlans.$inferSelect;
type Auth = { userId: string; householdId: string; memberId: string; role: string };

export type SetupProblem =
  | { kind: "unmapped_time"; severity: "error"; time: string; medicationIds: string[] }
  | { kind: "missing_quantity"; severity: "error"; medicationId: string; time: string }
  | { kind: "double_claim"; severity: "warning"; medicationId: string; time: string };

export type PlanView = {
  id: string;
  memberId: string;
  scheduleKind: "every_n_days" | "monthly_date";
  everyN: number | null;
  monthlyDay: number | null;
  anchorDate: string;
  fillLengthDays: number;
  reminderTime: string;
  version: number;
  archivedAt: string | null;
  compartments: Array<{ id: string; name: string; position: number }>;
  /** Dose time "HH:MM" to compartment id. */
  timeMap: Record<string, string>;
  caregiverMemberIds: string[];
  /** What is missing before the organizer can be filled by following the screen. */
  setup: {
    /** Every dose time that occurs in the next fill length, so each can be given a compartment. */
    doseTimes: string[];
    problems: SetupProblem[];
    /** Medications the organizer does not guide, and why (as needed, paused, no fixed times ...). */
    notGuided: Array<{ medicationId: string; reason: string }>;
    /** No errors and at least one dose to place. */
    ready: boolean;
  };
  canEdit: boolean;
};

const hhmm = (t: string) => t.slice(0, 5);

type Compartment = { id: string; name: string; position: number };

/** A plan's compartments, in order. */
export async function loadCompartments(db: Database, planId: string): Promise<Compartment[]> {
  return db
    .select({ id: healthOrganizerCompartments.id, name: healthOrganizerCompartments.name, position: healthOrganizerCompartments.position })
    .from(healthOrganizerCompartments)
    .where(eq(healthOrganizerCompartments.planId, planId))
    .orderBy(asc(healthOrganizerCompartments.position));
}

/** A plan's dose time ("HH:MM") to compartment id map. */
export async function loadTimeMap(db: Database, planId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ doseTime: healthOrganizerTimeMap.doseTime, compartmentId: healthOrganizerTimeMap.compartmentId })
    .from(healthOrganizerTimeMap)
    .where(eq(healthOrganizerTimeMap.planId, planId));
  return new Map(rows.map((r) => [hhmm(r.doseTime), r.compartmentId]));
}

/**
 * Where each pill goes, for a person's medications over `days` days from `from`. With `auth`, only the medications
 * and groups that person may see are used (what a setup screen shows); without it, all of them (what a filling session
 * is computed from, so every caregiver is told the same thing).
 */
export async function loadPlacements(
  db: Database,
  plan: PlanRow,
  opts: { from: string; days: number; auth?: Auth; compartments?: Compartment[]; timeMap?: Map<string, string> },
) {
  const compartments = opts.compartments ?? (await loadCompartments(db, plan.id));
  const timeMap = opts.timeMap ?? (await loadTimeMap(db, plan.id));
  const meds = await db
    .select()
    .from(healthMedications)
    .where(
      and(
        eq(healthMedications.householdId, plan.householdId),
        eq(healthMedications.memberId, plan.memberId),
        isNull(healthMedications.deletedAt),
        opts.auth ? healthMedicationVisibleWhere(db, opts.auth) : undefined,
      ),
    );
  // Groups the viewer cannot see are left out too: a private group can claim a time or clash with another,
  // and either would change the answer in a way that tells the viewer the group exists.
  const groups = await db
    .select()
    .from(healthMedicationGroups)
    .where(
      and(
        eq(healthMedicationGroups.householdId, plan.householdId),
        eq(healthMedicationGroups.memberId, plan.memberId),
        opts.auth ? healthMedicationGroupVisibleWhere(db, opts.auth) : undefined,
      ),
    );
  const memberships = groups.length
    ? await db
        .select()
        .from(healthMedicationGroupMembers)
        .where(inArray(healthMedicationGroupMembers.groupId, groups.map((g) => g.id)))
    : [];
  const quantities = await loadDoseQuantities(db, meds.map((m) => m.id));

  const organizerMeds: OrganizerMedication[] = meds.map((m) => ({
    id: m.id,
    scheduleKind: m.scheduleKind,
    form: m.form,
    scheduleJson: m.scheduleJson,
    startDate: m.startDate,
    endDate: m.endDate,
    enabled: m.enabled,
    deletedAt: m.deletedAt,
  }));
  const organizerGroups: OrganizerGroup[] = groups
    .filter((g) => g.scheduleKind === "scheduled" || g.scheduleKind === "interval")
    .map((g) => ({
      id: g.id,
      scheduleKind: g.scheduleKind as "scheduled" | "interval",
      scheduleJson: g.scheduleJson,
      startDate: g.startDate,
      endDate: g.endDate,
      enabled: g.enabled,
      medicationIds: memberships.filter((x) => x.groupId === g.id).map((x) => x.medicationId),
    }));

  const result = computePlacements({
    from: opts.from,
    days: opts.days,
    medications: organizerMeds,
    groups: organizerGroups,
    compartments,
    timeMap,
    quantities,
  });
  return { result, compartments, timeMap, medications: meds };
}

/** Setup problems and dose times for a person's medications over the plan's fill length, as `auth` may see them. */
async function computeSetup(db: Database, auth: Auth, plan: PlanRow, compartments: Compartment[], timeMap: Map<string, string>): Promise<PlanView["setup"]> {
  const today = await householdTodayIsoDate(db, auth.householdId);
  const { result } = await loadPlacements(db, plan, { from: today, days: plan.fillLengthDays, auth, compartments, timeMap });

  const times = new Set<string>();
  for (const p of result.placements) times.add(p.time);
  const problems: SetupProblem[] = [];
  for (const p of result.problems as PlacementProblem[]) {
    if (p.kind === "unmapped_time") {
      times.add(p.time);
      problems.push({ kind: "unmapped_time", severity: "error", time: p.time, medicationIds: p.medicationIds });
    } else if (p.kind === "missing_quantity") {
      times.add(p.time);
      problems.push({ kind: "missing_quantity", severity: "error", medicationId: p.medicationId, time: p.time });
    } else {
      times.add(p.time);
      // The ids of the groups involved are left out: the person may not be allowed to see those groups.
      problems.push({ kind: "double_claim", severity: "warning", medicationId: p.medicationId, time: p.time });
    }
  }
  return {
    doseTimes: [...times].sort(),
    problems,
    notGuided: result.notGuided.map((n) => ({ medicationId: n.medicationId, reason: n.reason })),
    ready: !problems.some((p) => p.severity === "error") && result.placements.length > 0,
  };
}

export async function loadPlanView(db: Database, auth: Auth, plan: PlanRow, canEdit: boolean): Promise<PlanView> {
  const compartmentRows = await loadCompartments(db, plan.id);
  const timeMap = await loadTimeMap(db, plan.id);
  const caregiverRows = await db
    .select({ memberId: healthOrganizerPlanCaregivers.memberId })
    .from(healthOrganizerPlanCaregivers)
    .where(eq(healthOrganizerPlanCaregivers.planId, plan.id));

  return {
    id: plan.id,
    memberId: plan.memberId,
    scheduleKind: plan.scheduleKind,
    everyN: plan.everyN,
    monthlyDay: plan.monthlyDay,
    anchorDate: plan.anchorDate,
    fillLengthDays: plan.fillLengthDays,
    reminderTime: hhmm(plan.reminderTime),
    version: plan.version,
    archivedAt: plan.archivedAt?.toISOString() ?? null,
    compartments: compartmentRows,
    timeMap: Object.fromEntries([...timeMap].sort(([a], [b]) => a.localeCompare(b))),
    caregiverMemberIds: caregiverRows.map((r) => r.memberId).sort(),
    setup: await computeSetup(db, auth, plan, compartmentRows, timeMap),
    canEdit,
  };
}
