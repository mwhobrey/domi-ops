"use client";

import type { ReactNode } from "react";
import { eventsForDate } from "../../lib/calendar-event-span";
import { eventDescriptionPlainText } from "../../lib/event-html";
import { eventColors, resolveEventColor } from "../../lib/calendar-event-colors";
import type { CalendarEventView } from "../../lib/calendar-utils";
import { parseLocalDate } from "../../lib/calendar-utils";
import { Button, Sheet } from "../ui";

export function CalendarDaySheet({
  open,
  date,
  events,
  onClose,
  onEventClick,
  onViewDay,
  footerExtra,
  categoryColorByKey,
}: {
  open: boolean;
  date: string | null;
  events: CalendarEventView[];
  categoryColorByKey?: Map<string, string | null>;
  onClose: () => void;
  onEventClick: (ev: CalendarEventView) => void;
  onViewDay?: () => void;
  footerExtra?: ReactNode;
}) {
  const dayEvents = date
    ? eventsForDate(events, date).sort((a, b) =>
        (a.startTime ?? "").localeCompare(b.startTime ?? ""),
      )
    : [];

  const label = date
    ? parseLocalDate(date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <Sheet open={open} onClose={onClose} title={label || "Day schedule"}>
      <div className="space-y-4 p-5">
        {footerExtra}
        {dayEvents.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Nothing scheduled this day.</p>
        ) : (
          <ul className="space-y-2">
            {dayEvents.map((ev) => {
              const colors = eventColors(
                resolveEventColor(ev, categoryColorByKey ?? new Map()),
              );
              const timeLabel = ev.allDay
                ? "All day"
                : [ev.startTime, ev.endTime].filter(Boolean).join(" – ") || "Timed";
              return (
              <li key={ev.id}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-3 text-left transition hover:bg-[var(--color-border)]/20"
                  onClick={() => onEventClick(ev)}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: colors.background }}
                    />
                    <span className="flex-1 font-medium">{ev.title}</span>
                    <span className="text-sm text-[var(--color-text-muted)]">{timeLabel}</span>
                  </span>
                  {ev.categoryLabel && (
                    <span className="pl-6 text-xs text-[var(--color-text-muted)]">
                      {ev.categoryLabel}
                    </span>
                  )}
                  {ev.description?.trim() && (
                    <span className="truncate pl-6 text-xs text-[var(--color-text-muted)]">
                      {eventDescriptionPlainText(ev.description)}
                    </span>
                  )}
                </button>
              </li>
            );
            })}
          </ul>
        )}
        {onViewDay && date && (
          <Button variant="secondary" size="sm" type="button" onClick={onViewDay}>
            Open day view
          </Button>
        )}
      </div>
    </Sheet>
  );
}
