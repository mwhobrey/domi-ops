import { createHash } from "node:crypto";
import { parseFixedTimeSchedule, scheduleHhmm } from "./health-schedule.js";

/**
 * Where each pill goes when filling a pill organizer (WHO-415).
 *
 * A dose is one medication at one clock time on one calendar day. The organizer needs to know, for
 * every dose in the days being filled, which compartment it belongs to and how many pills go in. This
 * module works that out and nothing else: no database, no clock, no time zone. Doses are local dates
 * plus "HH:MM" strings, so there is no daylight saving to get wrong; all the date math below is done
 * in UTC on the date alone.
 *
 * The rules deliberately match what reminders and the calendar already do, so the organizer never
 * disagrees with the dose a person is told to take:
 *
 * - A medication's own times, minus any time a scheduled group it belongs to claims, plus the group's
 *   dose at that time. A claimed time only exists on days the claiming group runs (the same as the
 *   reminder: the medication's own reminder is dropped for that time, the group's is the one that
 *   fires). Two groups running on the same day at the same time is reported as a warning and the dose
 *   is placed once.
 * - Unlike a reminder, a physical pill must also respect the medication itself: its weekdays and its
 *   start and end dates apply on top of the group's.
 * - Only `scheduled` (fixed clock time) medications are guided. As-needed, over-the-counter and
 *   interval medications, paused ones, and ones with no usable times are listed in `notGuided` with the
 *   reason so the screen can say why; they still work for pharmacy and supply tracking.
 *
 * Quantities are whole QUARTERS of a pill (0.25 = 1, 1.5 = 6) so fractions add up exactly.
 */

/** The most days one filling session may cover; matches the database limit on a session. */
export const MAX_ORGANIZER_DAYS = 93;

export type OrganizerMedication = {
  id: string;
  scheduleKind: "scheduled" | "prn" | "otc" | "interval";
  scheduleJson: string | null;
  startDate: string | null;
  endDate: string | null;
  enabled: boolean;
  /** Soft-deleted medications are left out entirely, not even listed as not guided. */
  deletedAt?: Date | null;
};

export type OrganizerGroup = {
  id: string;
  scheduleKind: "scheduled" | "interval";
  scheduleJson: string | null;
  startDate: string | null;
  endDate: string | null;
  enabled: boolean;
  /** The medications in the group. */
  medicationIds: readonly string[];
};

export type OrganizerCompartment = { id: string; name: string; position: number };

export type PlacementInput = {
  /** First local calendar day to fill, "YYYY-MM-DD". */
  from: string;
  /** How many days, 1 to MAX_ORGANIZER_DAYS. */
  days: number;
  medications: readonly OrganizerMedication[];
  groups: readonly OrganizerGroup[];
  compartments: readonly OrganizerCompartment[];
  /** Dose clock time "HH:MM" to compartment id. */
  timeMap: ReadonlyMap<string, string>;
  /** Medication id to (dose time "HH:MM" to quarters of a pill). */
  quantities: ReadonlyMap<string, ReadonlyMap<string, number>>;
};

export type Placement = {
  medicationId: string;
  date: string;
  time: string;
  compartmentId: string;
  quarters: number;
};

export type PlacementProblem =
  /** A dose time no compartment is assigned to. Blocks guided filling for those doses. */
  | { kind: "unmapped_time"; severity: "error"; time: string; medicationIds: string[] }
  /** A dose with no pill quantity entered. Blocks guided filling for that dose. */
  | { kind: "missing_quantity"; severity: "error"; medicationId: string; time: string }
  /** Two groups both run this medication's dose on the same day. The dose is placed once. */
  | { kind: "double_claim"; severity: "warning"; medicationId: string; time: string; groupIds: string[] };

export type NotGuidedReason = "as_needed" | "over_the_counter" | "interval" | "paused" | "no_times";

export type NotGuided = { medicationId: string; reason: NotGuidedReason };

export type MedicationPlacementSummary = {
  medicationId: string;
  /** Doses that fall in the days asked for, placed or not. */
  doseCount: number;
  /** Doses with a compartment and a quantity. */
  placedCount: number;
  totalQuarters: number;
  /** Quarters per compartment, in compartment order. */
  byCompartment: Array<{ compartmentId: string; quarters: number }>;
  /** Days with at least one placed dose. */
  dates: string[];
  /** False while any of this medication's doses is missing a compartment or a quantity. */
  complete: boolean;
};

export type PlacementResult = {
  from: string;
  to: string;
  days: number;
  placements: Placement[];
  byMedication: MedicationPlacementSummary[];
  problems: PlacementProblem[];
  notGuided: NotGuided[];
  /**
   * Stable fingerprint of everything that would change what the person is told to do: the range,
   * the compartments, every placement and every problem. A mapping edit that moves no dose does not
   * change it, because it would not change the instructions.
   */
  hash: string;
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function utcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  if (date.toISOString().slice(0, 10) !== iso) throw new RangeError(`Not a calendar date: ${iso}`);
  return date;
}

/** `iso` plus `n` days, in UTC so the process time zone can never move the answer. */
export function addDaysUtc(iso: string, n: number): string {
  const d = utcDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
function weekday(iso: string): number {
  return utcDate(iso).getUTCDay();
}

function within(date: string, start: string | null, end: string | null): boolean {
  return (!start || date >= start) && (!end || date <= end);
}

function usableTimes(raw: string | null): { times: string[]; daysOfWeek: number[] | undefined } {
  const parsed = parseFixedTimeSchedule(raw);
  const times = [...new Set((parsed.times ?? []).map(scheduleHhmm).filter((t) => HHMM.test(t)))].sort();
  return { times, daysOfWeek: parsed.daysOfWeek?.length ? parsed.daysOfWeek : undefined };
}

function runsOn(date: string, daysOfWeek: number[] | undefined): boolean {
  return !daysOfWeek || daysOfWeek.includes(weekday(date));
}

const NOT_GUIDED_BY_KIND = {
  prn: "as_needed",
  otc: "over_the_counter",
  interval: "interval",
} as const;

/** Quarters of a pill as people say it: 1 -> "¼", 6 -> "1½", 8 -> "2". */
export function formatQuarters(quarters: number): string {
  if (!Number.isInteger(quarters) || quarters < 0) throw new RangeError(`Not a whole number of quarters: ${quarters}`);
  const whole = Math.floor(quarters / 4);
  const fraction = ["", "¼", "½", "¾"][quarters % 4]!;
  if (whole === 0) return fraction || "0";
  return `${whole}${fraction}`;
}

export function computePlacements(input: PlacementInput): PlacementResult {
  if (!ISO_DATE.test(input.from)) throw new RangeError(`from must be YYYY-MM-DD, got ${input.from}`);
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_ORGANIZER_DAYS) {
    throw new RangeError(`days must be a whole number from 1 to ${MAX_ORGANIZER_DAYS}, got ${input.days}`);
  }
  const dates = Array.from({ length: input.days }, (_, i) => addDaysUtc(input.from, i));
  const to = dates[dates.length - 1]!;

  const compartments = [...input.compartments].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const position = new Map(compartments.map((c, i) => [c.id, i]));
  const knownCompartment = (time: string): string | undefined => {
    const id = input.timeMap.get(time);
    return id !== undefined && position.has(id) ? id : undefined;
  };

  const placements: Placement[] = [];
  const problems: PlacementProblem[] = [];
  const notGuided: NotGuided[] = [];
  const summaries: MedicationPlacementSummary[] = [];
  const unmapped = new Map<string, Set<string>>();

  const scheduledGroups = input.groups
    .filter((g) => g.enabled && g.scheduleKind === "scheduled")
    .map((g) => ({ group: g, ...usableTimes(g.scheduleJson) }));

  // Id order, so everything gathered below (not guided, medication lists inside problems) comes out in a
  // stable order whatever order the caller loaded them in.
  const medications = [...input.medications].sort((a, b) => a.id.localeCompare(b.id));
  for (const med of medications) {
    if (med.deletedAt) continue;
    if (med.scheduleKind !== "scheduled") {
      notGuided.push({ medicationId: med.id, reason: NOT_GUIDED_BY_KIND[med.scheduleKind] });
      continue;
    }
    if (!med.enabled) {
      notGuided.push({ medicationId: med.id, reason: "paused" });
      continue;
    }
    const own = usableTimes(med.scheduleJson);
    if (own.times.length === 0) {
      notGuided.push({ medicationId: med.id, reason: "no_times" });
      continue;
    }

    const myGroups = scheduledGroups.filter((g) => g.group.medicationIds.includes(med.id));
    const byCompartmentQuarters = new Map<string, number>();
    const placedDates = new Set<string>();
    let doseCount = 0;
    let placedCount = 0;
    let totalQuarters = 0;
    let complete = true;
    const reportedDouble = new Set<string>();
    const reportedQuantity = new Set<string>();

    for (const date of dates) {
      if (!within(date, med.startDate, med.endDate) || !runsOn(date, own.daysOfWeek)) continue;

      for (const time of own.times) {
        const claimers = myGroups.filter((g) => g.times.includes(time));
        if (claimers.length > 0) {
          const running = claimers.filter((g) => within(date, g.group.startDate, g.group.endDate) && runsOn(date, g.daysOfWeek));
          // Claimed by a group that is not running today: the dose does not exist today.
          if (running.length === 0) continue;
          if (running.length > 1 && !reportedDouble.has(time)) {
            reportedDouble.add(time);
            problems.push({
              kind: "double_claim",
              severity: "warning",
              medicationId: med.id,
              time,
              groupIds: running.map((g) => g.group.id).sort(),
            });
          }
        }

        doseCount += 1;
        const compartmentId = knownCompartment(time);
        if (!compartmentId) {
          complete = false;
          if (!unmapped.has(time)) unmapped.set(time, new Set());
          unmapped.get(time)!.add(med.id);
          continue;
        }
        const quarters = input.quantities.get(med.id)?.get(time);
        if (quarters === undefined || !Number.isInteger(quarters) || quarters < 1) {
          complete = false;
          if (!reportedQuantity.has(time)) {
            reportedQuantity.add(time);
            problems.push({ kind: "missing_quantity", severity: "error", medicationId: med.id, time });
          }
          continue;
        }

        placements.push({ medicationId: med.id, date, time, compartmentId, quarters });
        placedCount += 1;
        totalQuarters += quarters;
        placedDates.add(date);
        byCompartmentQuarters.set(compartmentId, (byCompartmentQuarters.get(compartmentId) ?? 0) + quarters);
      }
    }

    summaries.push({
      medicationId: med.id,
      doseCount,
      placedCount,
      totalQuarters,
      byCompartment: [...byCompartmentQuarters.entries()]
        .sort((a, b) => position.get(a[0])! - position.get(b[0])!)
        .map(([compartmentId, quarters]) => ({ compartmentId, quarters })),
      dates: [...placedDates].sort(),
      complete,
    });
  }

  for (const [time, ids] of [...unmapped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    problems.push({ kind: "unmapped_time", severity: "error", time, medicationIds: [...ids] });
  }

  placements.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      position.get(a.compartmentId)! - position.get(b.compartmentId)! ||
      a.time.localeCompare(b.time) ||
      a.medicationId.localeCompare(b.medicationId),
  );
  // What blocks filling first, warnings after; then grouped by kind.
  problems.sort(
    (a, b) =>
      Number(a.severity === "warning") - Number(b.severity === "warning") ||
      a.kind.localeCompare(b.kind) ||
      problemKey(a).localeCompare(problemKey(b)),
  );

  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        from: input.from,
        days: input.days,
        compartments: compartments.map((c) => [c.id, c.name, c.position]),
        placements: placements.map((p) => [p.medicationId, p.date, p.time, p.compartmentId, p.quarters]),
        problems,
        notGuided,
      }),
    )
    .digest("hex");

  return { from: input.from, to, days: input.days, placements, byMedication: summaries, problems, notGuided, hash };
}

function problemKey(p: PlacementProblem): string {
  switch (p.kind) {
    case "unmapped_time":
      return p.time;
    case "missing_quantity":
    case "double_claim":
      return `${p.medicationId}|${p.time}`;
  }
}
