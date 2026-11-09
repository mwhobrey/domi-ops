import { MAX_SUPPLY_DAYS, daysBetween, mergeRanges, type DateRange } from "./health-supply-arithmetic.js";
import {
  addDaysUtc,
  runningClaimers,
  runsOn,
  scheduledGroupTimes,
  usableTimes,
  within,
  type OrganizerGroup,
  type OrganizerMedication,
} from "./health-organizer-placements.js";
import { isMultiDayInterval, parseIntervalSchedule } from "./med-interval-schedule.js";

/**
 * Supply entered as a pill count. The estimate stays in days (see health-supply-arithmetic): a count is turned into the
 * whole days it covers on the way in, by walking the medication's real schedule, and nothing else ever reads pills. As
 * with the rest of supply, nothing here looks at a dose log.
 *
 * Counts are whole QUARTERS of a pill, like dose quantities, so they add up exactly.
 */

/** A hundred thousand pills. A bigger number is a typo, not a supply. */
export const MAX_SUPPLY_QUARTERS = 400_000;

export type PillDoseSchedule = {
  /** The last day the medication is taken, if it has one. */
  endDate: string | null;
  /** Quarters of a pill due on this day, in all; 0 on a day with no dose. An interval medication has no fixed days: always 0. */
  quartersOn: (date: string) => number;
  /** Set for an interval medication: it is counted in doses, not walked day by day. */
  interval?: { everyMinutes: number; quartersPerDose: number; startDate: string | null };
};

/**
 * An interval medication taken every day or longer, with its pills per dose entered. The interval is its group's when an
 * enabled interval group holds it, the same as its reminders. Shorter intervals have no steady count of doses a day.
 */
function intervalPillSchedule(med: OrganizerMedication, groups: readonly OrganizerGroup[]): PillDoseSchedule | null {
  const quartersPerDose = med.intervalDoseQuarters;
  if (!quartersPerDose || quartersPerDose < 1) return null;
  const group = groups.find((g) => g.enabled && g.scheduleKind === "interval" && g.medicationIds.includes(med.id));
  const schedule = parseIntervalSchedule(group ? group.scheduleJson : med.scheduleJson);
  if (!schedule || !isMultiDayInterval(schedule)) return null;
  return {
    endDate: med.endDate,
    quartersOn: () => 0,
    interval: { everyMinutes: schedule.everyMinutes, quartersPerDose, startDate: med.startDate },
  };
}

/**
 * The medication's pills per day, or null when it has no fixed daily dose to count against: not a pill, as needed, over
 * the counter, an interval shorter than a day or with no pills per dose entered, no usable times, or a time with no
 * quantity entered. These keep their supply in days.
 *
 * The rules are the organizer's, so a count and a fill never disagree about which days have a dose: a medication's own
 * weekdays and dates, and a time claimed by a group exists only on the days that group runs. A paused medication or one
 * kept out of the organizer still has a dose to count against.
 */
export function pillDoseSchedule(
  med: OrganizerMedication,
  groups: readonly OrganizerGroup[],
  quantities: ReadonlyMap<string, number> | undefined,
): PillDoseSchedule | null {
  if (med.deletedAt) return null;
  if (med.form !== undefined && med.form !== "pill") return null;
  if (med.scheduleKind === "interval") return intervalPillSchedule(med, groups);
  if (med.scheduleKind !== "scheduled" || !quantities) return null;
  const own = usableTimes(med.scheduleJson);
  if (own.times.length === 0) return null;
  const perTime = own.times.map((time) => ({ time, quarters: quantities.get(time) }));
  if (perTime.some((d) => d.quarters === undefined || !Number.isInteger(d.quarters) || d.quarters < 1)) return null;

  const myGroups = scheduledGroupTimes(groups).filter((g) => g.group.medicationIds.includes(med.id));
  return {
    endDate: med.endDate,
    quartersOn(date) {
      if (!within(date, med.startDate, med.endDate) || !runsOn(date, own.daysOfWeek)) return 0;
      return perTime.reduce((sum, d) => (runningClaimers(date, d.time, myGroups) === null ? sum : sum + d.quarters!), 0);
    },
  };
}

/**
 * How many days `quarters` of a pill last, walking the schedule from `from` (the first day they would be used, so the day
 * after the organizers run out). The answer goes straight into `outsideDays`: the first day without supply is `from` plus
 * this many days.
 *
 * A day counts only when the whole day's doses can be met, so what is left over is rounded down. Days with no dose cost
 * nothing and count, so five pills of a weekday medication started on a Monday last until the next Monday. A count that
 * outlasts the medication's end date stops the day after it, which is what marks the supply as covering the course.
 *
 * An interval medication is whole doses times the interval, counted from `from`. Its real next dose depends on when the
 * last one was logged, and supply never reads dose logs, so this can come out short by up to one interval. That errs
 * toward refilling early.
 *
 * @throws RangeError when the pills last past the longest supply there can be.
 */
export function quartersToDays(schedule: PillDoseSchedule, from: string, quarters: number): number {
  if (!Number.isInteger(quarters) || quarters < 0) throw new RangeError(`Not a whole number of quarters: ${quarters}`);
  if (schedule.interval) return intervalDays(schedule, schedule.interval, from, quarters);
  let left = quarters;
  for (let day = 0; day <= MAX_SUPPLY_DAYS; day += 1) {
    const date = addDaysUtc(from, day);
    if (schedule.endDate !== null && date > schedule.endDate) return day;
    const due = schedule.quartersOn(date);
    if (due > left) return day;
    left -= due;
  }
  throw new RangeError(`Those pills last longer than ${MAX_SUPPLY_DAYS} days`);
}

function intervalDays(schedule: PillDoseSchedule, interval: NonNullable<PillDoseSchedule["interval"]>, from: string, quarters: number): number {
  const doses = Math.floor(quarters / interval.quartersPerDose);
  const waiting = interval.startDate !== null && interval.startDate > from ? daysBetween(from, interval.startDate) : 0;
  const days = waiting + Math.floor((doses * interval.everyMinutes) / 1440);
  if (schedule.endDate !== null) {
    const throughEnd = Math.max(0, daysBetween(from, schedule.endDate) + 1);
    if (days >= throughEnd) return throughEnd;
  }
  if (days > MAX_SUPPLY_DAYS) throw new RangeError(`Those pills last longer than ${MAX_SUPPLY_DAYS} days`);
  return days;
}

/**
 * What the organizers cover, with the days that need no dose joined up. A weekday medication is filled Monday to Friday,
 * so its weekends look like holes, and on a Sunday its next fill looks like one that has not started. Neither is a gap:
 * nothing is missing on those days. A stretch with a dose in it is left as a gap, and only the days up to a later fill are
 * joined, so this never adds days past the last one filled.
 */
export function bridgeDoseFreeDays(ranges: readonly DateRange[], schedule: PillDoseSchedule, today: string): DateRange[] {
  const noDoseBetween = (first: string, last: string): boolean => {
    for (let date = first; date <= last; date = addDaysUtc(date, 1)) {
      if (schedule.quartersOn(date) > 0) return false;
    }
    return true;
  };
  const out: DateRange[] = [];
  for (const range of mergeRanges(ranges).filter((r) => r.to >= today)) {
    const previous = out[out.length - 1];
    if (previous) {
      if (noDoseBetween(addDaysUtc(previous.to, 1), addDaysUtc(range.from, -1))) previous.to = range.to;
      else out.push({ ...range });
    } else {
      out.push(range.from > today && noDoseBetween(today, addDaysUtc(range.from, -1)) ? { from: today, to: range.to } : { ...range });
    }
  }
  return out;
}

/** Quarters a fill of `range` takes out of the bottle: its doses on days that are not in the organizers already. */
export function quartersUsedByFill(
  doses: ReadonlyArray<{ date: string; quarters: number }>,
  alreadyCovered: readonly DateRange[],
  range: DateRange,
): number {
  return doses.reduce((sum, d) => {
    if (d.date < range.from || d.date > range.to) return sum;
    return alreadyCovered.some((r) => d.date >= r.from && d.date <= r.to) ? sum : sum + d.quarters;
  }, 0);
}

/** What should be left outside once a fill is done, for the person to correct; null when they never gave a count. */
export function outsideQuartersAfterFill(lastCount: number | null, used: number): number | null {
  return lastCount === null ? null : Math.max(0, lastCount - used);
}
