import { addDaysIso, zonedLocalToUtc } from "@domi-ops/calendar-sync";

const MINUTE_MS = 60_000;

/** A UTC instant interval, in epoch ms. `start === end` represents a zero-width point. */
export type Interval = { start: number; end: number };

export type TimedSpan = {
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  allDay: boolean;
  timeZone?: string | null;
};

export type CheckWindowInput =
  | { mode: "at"; date: string; time: string; timeZone?: string | null }
  | {
      mode: "range";
      startDate: string;
      startTime: string;
      endDate?: string;
      endTime: string;
      timeZone?: string | null;
    };

/** Resolves a calendar_events row (or the checked window) into a UTC instant interval. */
export function intervalForSpan(span: TimedSpan, fallbackTimeZone: string): Interval {
  const tz = span.timeZone || fallbackTimeZone;
  if (span.allDay) {
    const start = zonedLocalToUtc(span.startDate, "00:00", tz).getTime();
    const endExclusiveDate = addDaysIso(span.endDate ?? span.startDate, 1);
    const end = zonedLocalToUtc(endExclusiveDate, "00:00", tz).getTime();
    return { start, end };
  }
  const start = zonedLocalToUtc(span.startDate, span.startTime ?? "00:00", tz).getTime();
  if (!span.endTime) {
    // No end time on record — treat as a zero-duration point event.
    return { start, end: start };
  }
  const end = zonedLocalToUtc(span.endDate ?? span.startDate, span.endTime, tz).getTime();
  return { start, end };
}

export function intervalForCheckWindow(
  input: CheckWindowInput,
  fallbackTimeZone: string,
): Interval {
  const tz = input.timeZone || fallbackTimeZone;
  if (input.mode === "at") {
    const t = zonedLocalToUtc(input.date, input.time, tz).getTime();
    return { start: t, end: t };
  }
  const start = zonedLocalToUtc(input.startDate, input.startTime, tz).getTime();
  const end = zonedLocalToUtc(input.endDate ?? input.startDate, input.endTime, tz).getTime();
  return { start, end };
}

function isPoint(interval: Interval): boolean {
  return interval.start === interval.end;
}

/**
 * Half-open overlap for two true ranges (back-to-back events don't collide). When either side
 * is a zero-width point, containment is inclusive on both ends — an event ending exactly at a
 * checked instant still counts as "happening then".
 */
export function literalOverlap(a: Interval, b: Interval): boolean {
  if (!isPoint(a) && !isPoint(b)) {
    return a.start < b.end && b.start < a.end;
  }
  const point = isPoint(a) ? a.start : b.start;
  const range = isPoint(a) ? b : a;
  return range.start <= point && point <= range.end;
}

export function padInterval(interval: Interval, beforeMinutes: number, afterMinutes: number): Interval {
  return {
    start: interval.start - beforeMinutes * MINUTE_MS,
    end: interval.end + afterMinutes * MINUTE_MS,
  };
}

export type ConflictReason =
  | "literal_overlap"
  | "event_buffer_encroachment"
  | "check_buffer_encroachment";

export type ConflictClassification =
  | { severity: "red"; reason: "literal_overlap" }
  | { severity: "yellow"; reason: Exclude<ConflictReason, "literal_overlap"> }
  | { severity: null; reason: null };

/**
 * Classifies a single native event against the checked window. Red always wins over yellow;
 * meds are never passed through this function — they're informational only, no severity.
 */
export function classifyConflict(params: {
  checkInterval: Interval;
  checkBufferBeforeMinutes?: number;
  checkBufferAfterMinutes?: number;
  eventInterval: Interval;
  eventBufferBeforeMinutes?: number | null;
  eventBufferAfterMinutes?: number | null;
}): ConflictClassification {
  const { checkInterval, eventInterval } = params;

  if (literalOverlap(checkInterval, eventInterval)) {
    return { severity: "red", reason: "literal_overlap" };
  }

  const bufferedEvent = padInterval(
    eventInterval,
    params.eventBufferBeforeMinutes ?? 0,
    params.eventBufferAfterMinutes ?? 0,
  );
  if (literalOverlap(checkInterval, bufferedEvent)) {
    return { severity: "yellow", reason: "event_buffer_encroachment" };
  }

  const bufferedCheck = padInterval(
    checkInterval,
    params.checkBufferBeforeMinutes ?? 0,
    params.checkBufferAfterMinutes ?? 0,
  );
  if (literalOverlap(bufferedCheck, eventInterval)) {
    return { severity: "yellow", reason: "check_buffer_encroachment" };
  }

  return { severity: null, reason: null };
}
