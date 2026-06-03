"use client";

import { useMemo } from "react";

export interface CalendarEventView {
  id: string;
  title: string;
  startDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  color: string | null;
  calendarId: string;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function formatDay(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function CalendarWeek({
  events,
  weekStart,
}: {
  events: CalendarEventView[];
  weekStart?: string;
}) {
  const start = useMemo(() => {
    if (weekStart) return new Date(weekStart + "T12:00:00");
    return startOfWeek(new Date());
  }, [weekStart]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);

  const hours = Array.from({ length: 13 }, (_, i) => i + 7);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEventView[]>();
    for (const d of days) {
      map.set(d.toISOString().slice(0, 10), []);
    }
    for (const ev of events) {
      const list = map.get(ev.startDate);
      if (list) list.push(ev);
    }
    return map;
  }, [days, events]);

  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--color-border)]">
      <div className="grid min-w-[900px] grid-cols-8 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
        <div className="p-2 text-xs text-[var(--color-text-muted)]" />
        {days.map((d) => (
          <div key={d.toISOString()} className="border-l border-[var(--color-border)] p-2 text-center text-sm font-medium">
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
          const key = d.toISOString().slice(0, 10);
          const dayEvents = byDay.get(key) ?? [];
          return (
            <div key={key} className="relative border-l border-[var(--color-border)]">
              {hours.map((h) => (
                <div key={h} className="h-12 border-b border-[var(--color-border)]/30" />
              ))}
              {dayEvents.map((ev) => {
                const top = ev.allDay || !ev.startTime ? 0 : parseInt(ev.startTime.split(":")[0], 10) - 7;
                return (
                  <div
                    key={ev.id}
                    className="absolute left-1 right-1 rounded-md px-2 py-1 text-xs font-medium text-white shadow-sm"
                    style={{
                      top: `${Math.max(0, top) * 48 + 4}px`,
                      background: ev.color ?? "var(--color-accent)",
                      minHeight: "28px",
                    }}
                    title={ev.title}
                  >
                    {ev.title}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
