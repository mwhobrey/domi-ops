"use client";

import { useMemo } from "react";
import { cn } from "../lib/cn";
import { effectiveEndDate } from "../lib/calendar-event-span";
import { eventDescriptionPlainText } from "../lib/event-html";
import { eventColors, resolveEventColor } from "../lib/calendar-event-colors";
import type { CalendarEventView } from "../lib/calendar-utils";
import { addDays, formatDateLocal, parseLocalDate } from "../lib/calendar-utils";
import { EmptyState, Skeleton } from "./ui";

function formatEventTimeRange(ev: CalendarEventView): string {
  if (ev.allDay) return "All day";
  const start = ev.startTime ?? "";
  const end = ev.endTime && ev.endTime !== ev.startTime ? ` – ${ev.endTime}` : "";
  return `${start}${end}`.trim() || "Timed";
}

export function CalendarAgendaView({
  events,
  loading,
  categoryColorByKey,
  onEventClick,
  dayHeaderStickyTop,
}: {
  events: CalendarEventView[];
  loading?: boolean;
  categoryColorByKey?: Map<string, string | null>;
  onEventClick: (ev: CalendarEventView) => void;
  /** Sticky offset for day section headers (e.g. below calendar toolbar on /calendar). */
  dayHeaderStickyTop?: string;
}) {
  const today = formatDateLocal(new Date());

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEventView[]>();
    for (const ev of events) {
      let cursor = ev.startDate;
      const end = effectiveEndDate(ev);
      while (cursor <= end) {
        const list = map.get(cursor) ?? [];
        list.push(ev);
        map.set(cursor, list);
        cursor = formatDateLocal(addDays(parseLocalDate(cursor), 1));
      }
    }
    for (const [, list] of map) {
      list.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (events.length === 0) {
    return <EmptyState title="No events" description="Nothing scheduled in this range." />;
  }

  return (
    <div className="space-y-6">
      {grouped.map(([date, dayEvents]) => {
        const isToday = date === today;
        return (
          <section key={date}>
            <h3
              className={cn(
                "sticky z-10 mb-2 py-2 text-sm font-medium backdrop-blur-sm",
                !dayHeaderStickyTop && "top-[var(--header-height)]",
                isToday
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-text-muted)]",
              )}
              style={dayHeaderStickyTop ? { top: dayHeaderStickyTop } : undefined}
            >
              {isToday ? "Today · " : ""}
              {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h3>
            <ul className="space-y-2">
              {dayEvents.map((ev) => {
                const dotColor = resolveEventColor(ev, categoryColorByKey ?? new Map());
                const colors = eventColors(dotColor);
                return (
                <li key={`${date}-${ev.id}`}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-[var(--radius-lg)] border px-4 py-3 text-left transition hover:bg-[var(--color-border)]/20 sm:flex-row sm:items-center sm:gap-3",
                      isToday
                        ? "border-[var(--color-accent)]/40 bg-[var(--color-accent-subtle)]/30"
                        : "border-[var(--color-border)]",
                    )}
                    onClick={() => onEventClick(ev)}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ background: colors.background }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{ev.title}</span>
                        {ev.categoryLabel && (
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {ev.categoryLabel}
                          </span>
                        )}
                        {ev.description?.trim() && (
                          <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                            {eventDescriptionPlainText(ev.description)}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-[var(--color-text-muted)] sm:text-right">
                      {formatEventTimeRange(ev)}
                    </span>
                  </button>
                </li>
              );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
