"use client";

import type { CalendarEventView } from "../../lib/calendar-utils";
import { formatDateLocal } from "../../lib/calendar-utils";
import { eventsForDate } from "../../lib/calendar-event-span";
import type { ReschedulePatch } from "../../lib/calendar-time-grid";
import { CalendarTimeGrid } from "./CalendarTimeGrid";

export function CalendarDayView({
  focusDate,
  events,
  loading,
  onEventClick,
  interactionEnabled,
  onSlotClick,
  onEventReschedule,
  onAllDayReschedule,
  categoryColorByKey,
  fillViewport,
  className,
}: {
  focusDate: Date;
  events: CalendarEventView[];
  categoryColorByKey?: Map<string, string | null>;
  loading?: boolean;
  onEventClick: (ev: CalendarEventView) => void;
  interactionEnabled?: boolean;
  onSlotClick?: (date: string, hour: number) => void;
  onEventReschedule?: (ev: CalendarEventView, patch: ReschedulePatch) => void;
  onAllDayReschedule?: (ev: CalendarEventView, patch: ReschedulePatch) => void;
  fillViewport?: boolean;
  className?: string;
}) {
  const dateKey = formatDateLocal(focusDate);
  const dayEvents = eventsForDate(events, dateKey);

  return (
    <CalendarTimeGrid
      dates={[focusDate]}
      events={dayEvents}
      categoryColorByKey={categoryColorByKey}
      loading={loading}
      onEventClick={onEventClick}
      scrollToNow={dateKey === formatDateLocal(new Date())}
      interactionEnabled={interactionEnabled}
      fillViewport={fillViewport}
      className={className}
      onSlotClick={onSlotClick}
      onEventReschedule={onEventReschedule}
      onAllDayReschedule={onAllDayReschedule}
    />
  );
}

export function formatDayPeriodLabel(focusDate: Date): string {
  return focusDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
