import type { CalendarEventView } from "./calendar-utils";

export const GRID_START_HOUR = 0;
export const GRID_END_HOUR = 24;
export const SLOT_HEIGHT_PX = 48;
export const DEFAULT_EVENT_DURATION_MIN = 60;
export const MIN_EVENT_DURATION_MIN = 30;

export function gridTotalHeightPx(): number {
  return (GRID_END_HOUR - GRID_START_HOUR) * SLOT_HEIGHT_PX;
}

/** Parse HH:mm or HH:mm:ss to minutes since midnight. */
export function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const parts = time.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export { eventsForDate } from "./calendar-event-span";

export function partitionDayEvents(dayEvents: CalendarEventView[]): {
  allDay: CalendarEventView[];
  timed: CalendarEventView[];
} {
  const allDay: CalendarEventView[] = [];
  const timed: CalendarEventView[] = [];
  for (const ev of dayEvents) {
    if (ev.allDay) allDay.push(ev);
    else timed.push(ev);
  }
  timed.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  return { allDay, timed };
}

export type TimedEventLayout = {
  event: CalendarEventView;
  topPx: number;
  heightPx: number;
};

export function layoutTimedEvent(ev: CalendarEventView): TimedEventLayout {
  const startMin = parseTimeToMinutes(ev.startTime) ?? GRID_START_HOUR * 60;
  let endMin = parseTimeToMinutes(ev.endTime);
  if (endMin == null || endMin <= startMin) {
    endMin = startMin + DEFAULT_EVENT_DURATION_MIN;
  }
  const gridStartMin = GRID_START_HOUR * 60;
  const topPx = ((startMin - gridStartMin) / 60) * SLOT_HEIGHT_PX;
  const heightPx = Math.max(
    SLOT_HEIGHT_PX * 0.5,
    ((endMin - startMin) / 60) * SLOT_HEIGHT_PX,
  );
  return { event: ev, topPx: Math.max(0, topPx), heightPx };
}

export function layoutTimedEvents(events: CalendarEventView[]): TimedEventLayout[] {
  return events.map(layoutTimedEvent);
}

export function formatHourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  if (hour < 12) return `${hour}a`;
  return `${hour - 12}p`;
}

export function hourSlots(): number[] {
  return Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);
}

export function isViewingToday(dates: string[]): boolean {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const todayIso = `${y}-${m}-${day}`;
  return dates.includes(todayIso);
}

/** Minutes since midnight for scroll-into-view on current time. */
export function nowMinutesSinceMidnight(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

export function scrollTopForNow(): number {
  const gridStartMin = GRID_START_HOUR * 60;
  const now = nowMinutesSinceMidnight();
  const offset = ((now - gridStartMin) / 60) * SLOT_HEIGHT_PX;
  return Math.max(0, offset - SLOT_HEIGHT_PX * 2);
}

export function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function eventDurationMinutes(ev: CalendarEventView): number {
  const start = parseTimeToMinutes(ev.startTime) ?? GRID_START_HOUR * 60;
  let end = parseTimeToMinutes(ev.endTime);
  if (end == null || end <= start) {
    return DEFAULT_EVENT_DURATION_MIN;
  }
  return end - start;
}

/** Snap pointer offset within a day column to the start of an hour row. */
export function snapOffsetYToMinutes(offsetY: number): number {
  const hourIndex = Math.floor(offsetY / SLOT_HEIGHT_PX);
  const clampedHour = Math.max(GRID_START_HOUR, Math.min(GRID_END_HOUR - 1, GRID_START_HOUR + hourIndex));
  return clampedHour * 60;
}

export function offsetYToMinutes(offsetY: number): number {
  const minutes = GRID_START_HOUR * 60 + (offsetY / SLOT_HEIGHT_PX) * 60;
  const maxStart = GRID_END_HOUR * 60 - DEFAULT_EVENT_DURATION_MIN;
  return Math.max(GRID_START_HOUR * 60, Math.min(maxStart, minutes));
}

export type ReschedulePatch = {
  startDate: string;
  startTime?: string | null;
  endTime?: string | null;
};

export function buildAllDayReschedulePatch(
  _ev: CalendarEventView,
  targetDate: string,
): ReschedulePatch {
  return { startDate: targetDate, startTime: null, endTime: null };
}

export function buildReschedulePatch(
  ev: CalendarEventView,
  targetDate: string,
  startMinutes: number,
): ReschedulePatch {
  const duration = eventDurationMinutes(ev);
  const maxStart = GRID_END_HOUR * 60 - duration;
  const start = Math.max(GRID_START_HOUR * 60, Math.min(maxStart, startMinutes));
  return {
    startDate: targetDate,
    startTime: minutesToTimeString(start),
    endTime: minutesToTimeString(start + duration),
  };
}

/** Snap a column Y offset to minutes since midnight (15-minute steps). */
export function snapResizeMinutes(offsetY: number): number {
  const raw = offsetYToMinutes(offsetY);
  const snapped = Math.round(raw / 15) * 15;
  return Math.max(GRID_START_HOUR * 60, Math.min(GRID_END_HOUR * 60, snapped));
}

export function topPxFromMinutes(startMinutes: number): number {
  const gridStartMin = GRID_START_HOUR * 60;
  return ((startMinutes - gridStartMin) / 60) * SLOT_HEIGHT_PX;
}

export function heightPxFromDuration(durationMinutes: number): number {
  return Math.max(SLOT_HEIGHT_PX * 0.5, (durationMinutes / 60) * SLOT_HEIGHT_PX);
}

/** Snap end time from pointer Y within a day column (15-minute steps). */
export function snapEndOffsetYToMinutes(startMinutes: number, offsetY: number): number {
  const snapped = snapResizeMinutes(offsetY);
  const minEnd = startMinutes + MIN_EVENT_DURATION_MIN;
  const maxEnd = GRID_END_HOUR * 60;
  return Math.max(minEnd, Math.min(maxEnd, snapped));
}

/** Snap start time when resizing from the top edge; end time stays fixed. */
export function snapStartOffsetYToMinutes(endMinutes: number, offsetY: number): number {
  const snapped = snapResizeMinutes(offsetY);
  const maxStart = endMinutes - MIN_EVENT_DURATION_MIN;
  return Math.max(GRID_START_HOUR * 60, Math.min(maxStart, snapped));
}

export function endMinutesFromChipHeight(startMinutes: number, heightPx: number): number {
  const durationMin = Math.max(MIN_EVENT_DURATION_MIN, (heightPx / SLOT_HEIGHT_PX) * 60);
  const raw = startMinutes + durationMin;
  const snapped = Math.round(raw / 15) * 15;
  return Math.max(
    startMinutes + MIN_EVENT_DURATION_MIN,
    Math.min(GRID_END_HOUR * 60, snapped),
  );
}

export function buildResizePatch(ev: CalendarEventView, endMinutes: number): ReschedulePatch {
  const start = parseTimeToMinutes(ev.startTime) ?? GRID_START_HOUR * 60;
  const clampedEnd = Math.max(
    start + MIN_EVENT_DURATION_MIN,
    Math.min(GRID_END_HOUR * 60, endMinutes),
  );
  return {
    startDate: ev.startDate,
    startTime: minutesToTimeString(start),
    endTime: minutesToTimeString(clampedEnd),
  };
}

export function buildResizeStartPatch(
  ev: CalendarEventView,
  startMinutes: number,
): ReschedulePatch {
  const end =
    parseTimeToMinutes(ev.endTime) ??
    startMinutes + DEFAULT_EVENT_DURATION_MIN;
  const clampedStart = Math.max(
    GRID_START_HOUR * 60,
    Math.min(end - MIN_EVENT_DURATION_MIN, startMinutes),
  );
  return {
    startDate: ev.startDate,
    startTime: minutesToTimeString(clampedStart),
    endTime: minutesToTimeString(end),
  };
}

/** Find day column index from clientX against column element rects (excludes time gutter). */
export function columnIndexFromClientX(
  columnRects: { left: number; right: number }[],
  clientX: number,
): number | null {
  for (let i = 0; i < columnRects.length; i++) {
    const r = columnRects[i]!;
    if (clientX >= r.left && clientX < r.right) return i;
  }
  return null;
}
