"use client";

import type { CalendarEventView } from "../lib/calendar-utils";
import { addDays, formatDateLocal, startOfWeek } from "../lib/calendar-utils";
import type { ReschedulePatch } from "../lib/calendar-time-grid";
import { CalendarTimeGrid, weekDates } from "./calendar/CalendarTimeGrid";

function formatWeekPeriod(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${weekStart.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

export function formatWeekPeriodLabel(weekStart: Date): string {
  return formatWeekPeriod(weekStart);
}

export function CalendarWeek({
  events,
  weekStart,
  loading,
  onEventClick,
  interactionEnabled,
  onSlotClick,
  onEventReschedule,
  onAllDayReschedule,
  categoryColorByKey,
}: {
  events: CalendarEventView[];
  categoryColorByKey?: Map<string, string | null>;
  weekStart: Date;
  loading?: boolean;
  onEventClick: (ev: CalendarEventView) => void;
  interactionEnabled?: boolean;
  onSlotClick?: (date: string, hour: number) => void;
  onEventReschedule?: (ev: CalendarEventView, patch: ReschedulePatch) => void;
  onAllDayReschedule?: (ev: CalendarEventView, patch: ReschedulePatch) => void;
}) {
  const dates = weekDates(weekStart);
  const weekKeys = dates.map((d) => formatDateLocal(d));
  const todayKey = formatDateLocal(new Date());

  return (
    <CalendarTimeGrid
      dates={dates}
      events={events}
      loading={loading}
      onEventClick={onEventClick}
      scrollToNow={weekKeys.includes(todayKey)}
      interactionEnabled={interactionEnabled}
      onSlotClick={onSlotClick}
      onEventReschedule={onEventReschedule}
      onAllDayReschedule={onAllDayReschedule}
      categoryColorByKey={categoryColorByKey}
    />
  );
}

export { startOfWeek };
