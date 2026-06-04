import type { CalendarEventView } from "./calendar-utils";

export function effectiveEndDate(ev: Pick<CalendarEventView, "startDate" | "endDate">): string {
  return ev.endDate && ev.endDate >= ev.startDate ? ev.endDate : ev.startDate;
}

export function eventOverlapsDate(
  ev: Pick<CalendarEventView, "startDate" | "endDate">,
  dateKey: string,
): boolean {
  return dateKey >= ev.startDate && dateKey <= effectiveEndDate(ev);
}

export function eventsForDate(events: CalendarEventView[], date: string): CalendarEventView[] {
  return events.filter((e) => eventOverlapsDate(e, date));
}

export type SpanDayRole = "start" | "middle" | "end" | "single";

export function spanDayRole(
  ev: Pick<CalendarEventView, "startDate" | "endDate">,
  dateKey: string,
): SpanDayRole {
  const end = effectiveEndDate(ev);
  if (ev.startDate === end) return "single";
  if (dateKey === ev.startDate) return "start";
  if (dateKey === end) return "end";
  return "middle";
}
