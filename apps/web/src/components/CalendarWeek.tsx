"use client";

import { useMemo } from "react";
import { cn } from "../lib/cn";
import type { CalendarEventView } from "../lib/calendar-utils";
import { addDays, formatDateISO, startOfWeek } from "../lib/calendar-utils";
import { Button } from "./ui";

const MAX_VISIBLE = 4;

function formatDay(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function CalendarWeek({
  events,
  weekStart,
  loading,
  onWeekChange,
  onEventClick,
  onMoreClick,
}: {
  events: CalendarEventView[];
  weekStart: Date;
  loading?: boolean;
  onWeekChange: (start: Date) => void;
  onEventClick: (ev: CalendarEventView) => void;
  onMoreClick?: (date: string, dayEvents: CalendarEventView[]) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const hours = Array.from({ length: 13 }, (_, i) => i + 7);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEventView[]>();
    for (const d of days) map.set(formatDateISO(d), []);
    for (const ev of events) {
      const list = map.get(ev.startDate);
      if (list) list.push(ev);
    }
    return map;
  }, [days, events]);

  const allDayByDay = useMemo(() => {
    const map = new Map<string, CalendarEventView[]>();
    for (const [key, list] of byDay) {
      map.set(
        key,
        list.filter((e) => e.allDay),
      );
    }
    return map;
  }, [byDay]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onWeekChange(addDays(weekStart, -7))}>
          Prev
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onWeekChange(startOfWeek(new Date()))}>
          Today
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onWeekChange(addDays(weekStart, 7))}>
          Next
        </Button>
        <span className="text-sm text-[var(--color-text-muted)]">
          {formatDay(days[0])} – {formatDay(days[6])}
        </span>
        {loading && <span className="text-sm text-[var(--color-text-muted)]">Loading…</span>}
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--color-border)]">
        <div className="grid min-w-[900px] grid-cols-8 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
          <div className="p-2 text-xs text-[var(--color-text-muted)]">All day</div>
          {days.map((d) => {
            const key = formatDateISO(d);
            const allDay = allDayByDay.get(key) ?? [];
            return (
              <div key={key} className="border-l border-[var(--color-border)] p-1">
                {allDay.slice(0, MAX_VISIBLE).map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    className="mb-1 block w-full truncate rounded px-1 py-0.5 text-left text-xs text-white"
                    style={{ background: ev.color ?? "var(--color-accent)" }}
                    onClick={() => onEventClick(ev)}
                  >
                    {ev.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="grid min-w-[900px] grid-cols-8 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
          <div className="p-2 text-xs text-[var(--color-text-muted)]" />
          {days.map((d) => (
            <div
              key={d.toISOString()}
              className="border-l border-[var(--color-border)] p-2 text-center text-sm font-medium"
            >
              {formatDay(d)}
            </div>
          ))}
        </div>
        <div className="grid min-w-[900px] grid-cols-8">
          <div className="border-r border-[var(--color-border)]">
            {hours.map((h) => (
              <div
                key={h}
                className="h-12 border-b border-[var(--color-border)]/50 px-2 text-right text-xs text-[var(--color-text-muted)]"
              >
                {h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const key = formatDateISO(d);
            const timed = (byDay.get(key) ?? []).filter((e) => !e.allDay);
            const visible = timed.slice(0, MAX_VISIBLE);
            const overflow = timed.length - visible.length;
            return (
              <div key={key} className="relative border-l border-[var(--color-border)]">
                {hours.map((h) => (
                  <div key={h} className="h-12 border-b border-[var(--color-border)]/30" />
                ))}
                {visible.map((ev) => {
                  const top = ev.startTime ? parseInt(ev.startTime.split(":")[0], 10) - 7 : 0;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      className={cn(
                        "absolute left-1 right-1 rounded-md px-2 py-1 text-left text-xs font-medium text-white shadow-sm hover:opacity-90",
                      )}
                      style={{
                        top: `${Math.max(0, top) * 48 + 4}px`,
                        background: ev.color ?? "var(--color-accent)",
                        minHeight: "28px",
                      }}
                      onClick={() => onEventClick(ev)}
                    >
                      {ev.title}
                    </button>
                  );
                })}
                {overflow > 0 && (
                  <button
                    type="button"
                    className="absolute bottom-2 left-2 text-xs text-[var(--color-accent)]"
                    onClick={() => onMoreClick?.(key, timed)}
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
