"use client";

import { useMemo } from "react";
import type { CalendarEventView } from "../lib/calendar-utils";
import { EmptyState, Skeleton } from "./ui";

export function CalendarAgendaView({
  events,
  loading,
  onEventClick,
}: {
  events: CalendarEventView[];
  loading?: boolean;
  onEventClick: (ev: CalendarEventView) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEventView[]>();
    for (const ev of events) {
      const list = map.get(ev.startDate) ?? [];
      list.push(ev);
      map.set(ev.startDate, list);
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
      {grouped.map(([date, dayEvents]) => (
        <section key={date}>
          <h3 className="mb-2 text-sm font-medium text-[var(--color-text-muted)]">
            {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </h3>
          <ul className="space-y-2">
            {dayEvents.map((ev) => (
              <li key={ev.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-border)]/20"
                  onClick={() => onEventClick(ev)}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: ev.color ?? "var(--color-accent)" }}
                  />
                  <span className="flex-1 font-medium">{ev.title}</span>
                  <span className="text-sm text-[var(--color-text-muted)]">
                    {ev.allDay ? "All day" : (ev.startTime ?? "")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
