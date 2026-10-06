import { addDaysUtc, type Placement } from "./health-organizer-placements.js";
import { mergeRanges, type DateRange } from "./health-supply-arithmetic.js";

/**
 * The arithmetic behind a filling session (WHO-426): how far along each medication is, where the next session
 * should start, and what changed between the instructions a session started with and the ones that apply now.
 * Dates are household-local calendar days handled as dates alone, so nothing here depends on a time zone.
 */

export type FillProgress = {
  /**
   * `filled`: every day with a dose is covered. `partial`: some are. `pending`: none are. `nothing_to_fill`:
   * the medication has no dose in the days being filled, so there is nothing to put in.
   */
  status: "pending" | "partial" | "filled" | "nothing_to_fill";
  requiredCount: number;
  coveredCount: number;
  /** The covered stretches, merged, as filled (not clipped to the days with doses). */
  covered: DateRange[];
  /** The days with a dose that no fill covers, run together where they are consecutive days. */
  missing: DateRange[];
};

/**
 * How much of a medication's days have been filled. `requiredDates` are the days it has a dose in the session
 * window; `ranges` are the stretches filled so far (any number, overlapping or not, undone ones already left out).
 */
export function fillProgress(requiredDates: readonly string[], ranges: readonly DateRange[]): FillProgress {
  const required = [...new Set(requiredDates)].sort();
  const covered = mergeRanges(ranges);
  const isCovered = (date: string) => covered.some((r) => date >= r.from && date <= r.to);
  const missingDates = required.filter((d) => !isCovered(d));

  const missing: DateRange[] = [];
  for (const date of missingDates) {
    const last = missing[missing.length - 1];
    if (last && addDaysUtc(last.to, 1) === date) last.to = date;
    else missing.push({ from: date, to: date });
  }

  const coveredCount = required.length - missingDates.length;
  const status = required.length === 0 ? "nothing_to_fill" : coveredCount === required.length ? "filled" : coveredCount === 0 ? "pending" : "partial";
  return { status, requiredCount: required.length, coveredCount, covered, missing };
}

/**
 * Where the next session should start: the day after the last day any organizer is filled to, but never before
 * today (a first session, or one after the pills ran out, starts today).
 */
export function nextUncoveredDay(ranges: readonly DateRange[], today: string): string {
  let latest: string | null = null;
  for (const r of ranges) if (latest === null || r.to > latest) latest = r.to;
  if (latest === null) return today;
  const next = addDaysUtc(latest, 1);
  return next > today ? next : today;
}

export type ChangeKind =
  /** A dose now falls on a day or time it did not, or no longer does. */
  | "schedule"
  /** The same dose now takes a different number of pills. */
  | "quantity"
  /** The same dose now goes in a different compartment. */
  | "compartment";

export type MedicationChange = {
  medicationId: string;
  kinds: ChangeKind[];
  added: number;
  removed: number;
  quantityChanged: number;
  compartmentChanged: number;
  /** A few of the days affected, oldest first. */
  dates: string[];
};

export type PlacementDiff = { changed: boolean; medications: MedicationChange[] };

const SAMPLE_DATES = 8;
const slot = (p: Pick<Placement, "medicationId" | "date" | "time">) => `${p.medicationId}|${p.date}|${p.time}`;

/**
 * What differs between two sets of placements: for each medication affected, whether doses were added or removed
 * (the schedule), or the same dose changed pill count or compartment.
 */
export function diffPlacements(before: readonly Placement[], after: readonly Placement[]): PlacementDiff {
  const old = new Map(before.map((p) => [slot(p), p]));
  const now = new Map(after.map((p) => [slot(p), p]));
  const byMed = new Map<string, MedicationChange & { dateSet: Set<string> }>();
  const entry = (medicationId: string) => {
    let e = byMed.get(medicationId);
    if (!e) {
      e = { medicationId, kinds: [], added: 0, removed: 0, quantityChanged: 0, compartmentChanged: 0, dates: [], dateSet: new Set() };
      byMed.set(medicationId, e);
    }
    return e;
  };

  for (const [key, p] of now) {
    const was = old.get(key);
    if (!was) {
      const e = entry(p.medicationId);
      e.added += 1;
      e.dateSet.add(p.date);
    } else {
      if (was.quarters !== p.quarters) {
        const e = entry(p.medicationId);
        e.quantityChanged += 1;
        e.dateSet.add(p.date);
      }
      if (was.compartmentId !== p.compartmentId) {
        const e = entry(p.medicationId);
        e.compartmentChanged += 1;
        e.dateSet.add(p.date);
      }
    }
  }
  for (const [key, p] of old) {
    if (!now.has(key)) {
      const e = entry(p.medicationId);
      e.removed += 1;
      e.dateSet.add(p.date);
    }
  }

  const medications = [...byMed.values()]
    .map(({ dateSet, ...e }) => ({
      ...e,
      kinds: [
        ...(e.added || e.removed ? (["schedule"] as const) : []),
        ...(e.quantityChanged ? (["quantity"] as const) : []),
        ...(e.compartmentChanged ? (["compartment"] as const) : []),
      ],
      dates: [...dateSet].sort().slice(0, SAMPLE_DATES),
    }))
    .sort((a, b) => a.medicationId.localeCompare(b.medicationId));
  return { changed: medications.length > 0, medications };
}
