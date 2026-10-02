import { expandScheduledSlots } from "./health-schedule.js";
import { zonedLocalToUtc } from "./household-time.js";
import {
  nextIntervalPending,
  type IntervalLog,
  type IntervalSchedule,
} from "./med-interval-schedule.js";

/**
 * Slot generation and status for scheduled health checks (WHO-384). Pure: no I/O, no clock, so the
 * dashboard, the Today tab, calendar overlays, reports and the reminder worker all answer "is this
 * slot done?" with the same code instead of five reimplementations.
 */

/**
 * How close (in either direction) an entry that was not logged *from* the check must be to a slot
 * to count as completing it. Same 30 minutes the schedule-conflict checker uses for medications
 * (`MED_DUE_POINT_TOLERANCE_MINUTES`). The edge is inclusive.
 *
 * It only applies to inferred matches. An entry linked to a slot with `recordCheck` counts however
 * early or late it was taken.
 */
export const CHECK_SLOT_TOLERANCE_MINUTES = 30;
export const CHECK_SLOT_TOLERANCE_MS = CHECK_SLOT_TOLERANCE_MINUTES * 60_000;

// ---------------------------------------------------------------------------------------------
// Which instants are slots
// ---------------------------------------------------------------------------------------------

export type PausePeriod = { pausedAt: Date; resumedAt: Date | null };

/**
 * Drop instants that were never due: inside a pause (`resumedAt` null = still paused), or at /
 * after deletion. Shared with medication adherence (WHO-338).
 */
export function excludeInactiveInstants(
  instants: Date[],
  pauses: PausePeriod[],
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

/**
 * Slots of a `scheduled` check (clock times, optional weekdays) over `dates`, in `timeZone`,
 * without the ones that fall in a pause or after deletion. A check created paused has an open
 * pause from its creation, so it has no slots until it is resumed.
 */
export function scheduledCheckSlots(input: {
  times?: readonly string[] | null;
  daysOfWeek?: readonly number[] | null;
  startDate?: string | null;
  endDate?: string | null;
  dates: readonly string[];
  timeZone: string;
  pauses?: PausePeriod[];
  deletedAt?: Date | null;
}): Date[] {
  const slots = expandScheduledSlots({
    times: input.times,
    daysOfWeek: input.daysOfWeek,
    startDate: input.startDate,
    endDate: input.endDate,
    dates: input.dates,
    timeZone: input.timeZone,
  }).map((s) => s.scheduledAt);
  return excludeInactiveInstants(slots, input.pauses ?? [], input.deletedAt ?? null);
}

/**
 * Slots of an `interval` check: the one pending slot the interval engine offers for each date,
 * the same way medication calendar overlays do. Slots that were already answered come from the
 * check's logs, so callers add `logs[].scheduledAt` themselves.
 *
 * `logs` are `taken`-style entries for the engine: `loggedAt` is when the reading was actually
 * taken, because "every N hours from the last one" runs off the reading, not off the tap.
 */
export function intervalCheckSlots(input: {
  schedule: IntervalSchedule;
  dates: readonly string[];
  today: string;
  now: Date;
  timeZone: string;
  logs: IntervalLog[];
  startDate?: string | null;
  endDate?: string | null;
  pauses?: PausePeriod[];
  deletedAt?: Date | null;
  /**
   * Include the "start" slot offered today when the schedule begins at the first reading. It is
   * created at `now` on every call, so it is right for showing a Start button and wrong for
   * anything that keys on the slot's instant, like a reminder. Default true.
   */
  includeAwaitingFirst?: boolean;
}): Date[] {
  const slots: Date[] = [];
  for (const date of input.dates) {
    if (input.startDate && date < input.startDate) continue;
    if (input.endDate && date > input.endDate) continue;
    const pending = nextIntervalPending({
      schedule: input.schedule,
      tz: input.timeZone,
      date,
      now: date === input.today ? input.now : zonedLocalToUtc(date, "12:00", input.timeZone),
      logs: input.logs,
    });
    if (!pending) continue;
    // "Start" only makes sense today; it is not a slot on any other day.
    if (pending.awaitingFirst && (date !== input.today || input.includeAwaitingFirst === false)) continue;
    slots.push(pending.scheduledAt);
  }
  return excludeInactiveInstants(slots, input.pauses ?? [], input.deletedAt ?? null);
}

// ---------------------------------------------------------------------------------------------
// Which entries can complete a slot
// ---------------------------------------------------------------------------------------------

export type CheckSlotEvent = {
  id: string;
  memberId: string;
  type: string;
  /** null = no time, so it cannot be matched to a slot by time. */
  startedAt: Date | null;
  /** For vitals: the metrics this entry actually holds (e.g. `blood_pressure_systolic`). */
  metrics?: readonly string[];
};

export type CheckForSlots = {
  eventType: string;
  memberId: string;
  /** The template's metrics for a vitals check. Empty / undefined = no requirement. */
  requiredMetrics?: readonly string[];
};

/**
 * Could this entry stand in for the check, if nobody linked it? Same person, same kind of entry
 * and, for vitals, every metric the check asks for. A weight-only entry must not complete a
 * blood pressure check. (A *linked* entry skips this: that was the person's own call.)
 */
export function eventQualifiesForCheck(event: CheckSlotEvent, check: CheckForSlots): boolean {
  if (event.type !== check.eventType || event.memberId !== check.memberId) return false;
  const required = check.requiredMetrics ?? [];
  if (required.length === 0) return true;
  const have = new Set(event.metrics ?? []);
  return required.every((m) => have.has(m));
}

/**
 * Pair unanswered slots with unlinked entries, closest first: each entry completes at most one
 * slot and each slot takes at most one entry, so a single reading can't tick two adjacent slots.
 * Ties go to the earlier slot, then the earlier entry, then the lower id, so the answer never
 * depends on input order. Returns slot instant (ms) -> entry.
 */
export function matchEventsToSlots(input: {
  slots: readonly Date[];
  events: readonly CheckSlotEvent[];
  toleranceMs?: number;
}): Map<number, CheckSlotEvent> {
  const tolerance = input.toleranceMs ?? CHECK_SLOT_TOLERANCE_MS;
  const pairs: { slot: number; event: CheckSlotEvent; time: number; delta: number }[] = [];
  for (const slot of input.slots) {
    for (const event of input.events) {
      if (!event.startedAt) continue;
      const delta = Math.abs(event.startedAt.getTime() - slot.getTime());
      if (delta <= tolerance) {
        pairs.push({ slot: slot.getTime(), event, time: event.startedAt.getTime(), delta });
      }
    }
  }
  pairs.sort(
    (a, b) =>
      a.delta - b.delta ||
      a.slot - b.slot ||
      a.time - b.time ||
      (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0),
  );

  const matched = new Map<number, CheckSlotEvent>();
  const usedEvents = new Set<string>();
  for (const pair of pairs) {
    if (matched.has(pair.slot) || usedEvents.has(pair.event.id)) continue;
    matched.set(pair.slot, pair.event);
    usedEvents.add(pair.event.id);
  }
  return matched;
}

// ---------------------------------------------------------------------------------------------
// Slot status
// ---------------------------------------------------------------------------------------------

export type CheckSlotLog = {
  id: string;
  scheduledAt: Date;
  status: "done" | "skipped" | "missed";
  /** The entry that completes the slot (null for skipped / missed). */
  healthEventId: string | null;
};

/**
 * - `done` / `skipped` / `missed`: answered, by a log row or (done only) by an inferred entry.
 * - `upcoming`: the slot is still ahead.
 * - `due`: the slot has arrived and is within the tolerance window.
 * - `overdue`: past the tolerance window with no answer. Reports count these as missed.
 */
export type SlotStatus = "done" | "skipped" | "missed" | "due" | "overdue" | "upcoming";

export type SlotResult = {
  scheduledAt: Date;
  status: SlotStatus;
  /** What answered it: an explicit log row, an inferred entry, or nothing yet. */
  source: "log" | "event" | null;
  logId: string | null;
  /** The completing entry, whether linked by a log or inferred. */
  eventId: string | null;
};

function minuteMs(at: Date): number {
  return Math.floor(at.getTime() / 60_000) * 60_000;
}

/**
 * Status of every slot of one check.
 *
 * 1. An explicit log row always wins, including a deliberate skip over a matching entry.
 * 2. Entries already linked to *any* slot of this check are spoken for, so they are never also
 *    used to infer a different slot.
 * 3. Of the rest, qualifying entries within the tolerance window complete unanswered slots,
 *    closest first, one entry per slot.
 * 4. Whatever is left is upcoming, due or overdue by the clock.
 *
 * `slots` decides which slots exist (so pauses, schedule edits and date bounds are the caller's
 * business); logs for instants that are not in `slots` are ignored here. `logs` should cover the
 * linked entries too, even for slots outside the range. Result is ordered by slot time.
 */
export function computeSlotStatuses(input: {
  check: CheckForSlots;
  slots: readonly Date[];
  logs: readonly CheckSlotLog[];
  events: readonly CheckSlotEvent[];
  now: Date;
  toleranceMs?: number;
}): SlotResult[] {
  const tolerance = input.toleranceMs ?? CHECK_SLOT_TOLERANCE_MS;
  const nowMs = input.now.getTime();

  const slotTimes = [...new Set(input.slots.map(minuteMs))].sort((a, b) => a - b);
  const logBySlot = new Map<number, CheckSlotLog>();
  for (const log of input.logs) logBySlot.set(minuteMs(log.scheduledAt), log);
  const linkedEventIds = new Set(
    input.logs.map((l) => l.healthEventId).filter((id): id is string => id != null),
  );

  const unanswered = slotTimes.filter((t) => !logBySlot.has(t)).map((t) => new Date(t));
  const candidates = input.events.filter(
    (e) => !linkedEventIds.has(e.id) && eventQualifiesForCheck(e, input.check),
  );
  const inferred = matchEventsToSlots({ slots: unanswered, events: candidates, toleranceMs: tolerance });

  return slotTimes.map((t): SlotResult => {
    const scheduledAt = new Date(t);
    const log = logBySlot.get(t);
    if (log) {
      return { scheduledAt, status: log.status, source: "log", logId: log.id, eventId: log.healthEventId };
    }
    const event = inferred.get(t);
    if (event) return { scheduledAt, status: "done", source: "event", logId: null, eventId: event.id };

    const status: SlotStatus = nowMs < t ? "upcoming" : nowMs < t + tolerance ? "due" : "overdue";
    return { scheduledAt, status, source: null, logId: null, eventId: null };
  });
}
