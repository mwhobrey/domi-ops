"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { eventOverlapsDate } from "../../lib/calendar-event-span";
import { resolveEventColor } from "../../lib/calendar-event-colors";
import type { CalendarEventView } from "../../lib/calendar-utils";
import { formatWallClock, monthGrid, parseLocalDate } from "../../lib/calendar-utils";
import { useHouseholdToday } from "../HouseholdTimeProvider";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TITLES_PER_CELL = 3;

function compareInDay(a: CalendarEventView, b: CalendarEventView): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.title.localeCompare(b.title);
}

export function CalendarMonthView({
  monthStart,
  events,
  compact = false,
  showTitles = false,
  categoryColorByKey,
  onDaySelect,
}: {
  monthStart: Date;
  events: CalendarEventView[];
  compact?: boolean;
  /** Event titles in each cell (full calendar page on wide screens); otherwise a count. */
  showTitles?: boolean;
  categoryColorByKey?: Map<string, string | null>;
  onDaySelect: (date: string) => void;
}) {
  const today = useHouseholdToday();
  const cells = useMemo(() => monthGrid(monthStart, today), [monthStart, today]);
  const eventsByDate = useMemo(() => {
    const byDate = new Map<string, CalendarEventView[]>();
    for (const cell of cells) {
      if (!cell.inMonth) continue;
      const dayEvents = events.filter((e) => eventOverlapsDate(e, cell.date)).sort(compareInDay);
      if (dayEvents.length > 0) byDate.set(cell.date, dayEvents);
    }
    return byDate;
  }, [cells, events]);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const inMonthIndices = useMemo(
    () => cells.map((c, i) => (c.inMonth ? i : -1)).filter((i) => i >= 0),
    [cells],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (!cells[index]?.inMonth) return;
      const pos = inMonthIndices.indexOf(index);
      if (pos < 0) return;
      let next = pos;
      if (e.key === "ArrowRight") next = Math.min(pos + 1, inMonthIndices.length - 1);
      else if (e.key === "ArrowLeft") next = Math.max(pos - 1, 0);
      else if (e.key === "ArrowDown") next = Math.min(pos + 7, inMonthIndices.length - 1);
      else if (e.key === "ArrowUp") next = Math.max(pos - 7, 0);
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onDaySelect(cells[index]!.date);
        return;
      } else return;
      e.preventDefault();
      const nextIndex = inMonthIndices[next]!;
      setFocusedIndex(nextIndex);
      cellRefs.current[nextIndex]?.focus();
    },
    [cells, inMonthIndices, onDaySelect],
  );

  return (
    <div role="grid" aria-label="Month calendar">
      <div
        className={cn(
          "mb-1 grid grid-cols-7 text-center font-medium text-[var(--color-text-muted)]",
          compact ? "text-[10px]" : "gap-1 text-xs",
        )}
      >
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader">
            {d}
          </div>
        ))}
      </div>
      <div className={cn("grid grid-cols-7", compact ? "gap-0.5" : "gap-1")}>
        {cells.map((cell, index) => {
          const dayEvents = eventsByDate.get(cell.date) ?? [];
          const eventCount = dayEvents.length;
          const hasEvents = eventCount > 0;
          const focused = focusedIndex === index;
          return (
            <button
              key={cell.date}
              ref={(el) => {
                cellRefs.current[index] = el;
              }}
              type="button"
              role="gridcell"
              tabIndex={cell.inMonth && (focused || focusedIndex === null) ? 0 : -1}
              disabled={!cell.inMonth}
              aria-label={
                cell.inMonth
                  ? `${parseLocalDate(cell.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}${hasEvents ? `, ${eventCount} event${eventCount === 1 ? "" : "s"}` : ""}`
                  : undefined
              }
              onFocus={() => cell.inMonth && setFocusedIndex(index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onClick={() => {
                if (!cell.inMonth) return;
                onDaySelect(cell.date);
              }}
              className={cn(
                "relative flex flex-col justify-start rounded-[var(--radius-md)] border transition",
                showTitles ? "items-stretch" : "items-center",
                compact
                  ? "min-h-[2rem] p-0.5 text-xs sm:min-h-[2.35rem]"
                  : showTitles
                    ? "min-h-[6.5rem] p-1 text-sm"
                    : "min-h-[3.25rem] p-1 text-sm sm:min-h-[4rem]",
                !cell.inMonth && "cursor-default border-transparent opacity-30",
                cell.inMonth &&
                  "border-[var(--color-border)]/60 hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-subtle)]",
                cell.isToday && cell.inMonth && "border-[var(--color-accent)]/60",
                focused && cell.inMonth && "ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-surface)]",
              )}
            >
              <span
                className={cn(
                  "font-medium tabular-nums",
                  showTitles && "self-start px-1",
                  cell.isToday && cell.inMonth && "text-[var(--color-accent)]",
                )}
              >
                {cell.day}
              </span>
              {hasEvents && cell.inMonth && showTitles ? (
                <span className="mt-1 flex min-w-0 flex-col gap-0.5 text-left">
                  {dayEvents.slice(0, TITLES_PER_CELL).map((ev) => (
                    <span
                      key={ev.id}
                      className="flex min-w-0 items-center gap-1 rounded px-1 text-[11px] leading-tight text-[var(--color-text)]"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                        style={(() => {
                          const color = resolveEventColor(ev, categoryColorByKey ?? new Map());
                          return color ? { backgroundColor: color } : undefined;
                        })()}
                        aria-hidden
                      />
                      {!ev.allDay && ev.startTime ? (
                        <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">
                          {formatWallClock(ev.startTime).replace(":00 ", " ")}
                        </span>
                      ) : null}
                      <span className="truncate">{ev.title}</span>
                    </span>
                  ))}
                  {eventCount > TITLES_PER_CELL ? (
                    <span className="px-1 text-[11px] font-medium text-[var(--color-accent)]">
                      +{eventCount - TITLES_PER_CELL} more
                    </span>
                  ) : null}
                </span>
              ) : null}
              {hasEvents && cell.inMonth && !showTitles && (
                <span
                  className="mt-auto text-[10px] font-medium tabular-nums text-[var(--color-accent)]"
                  title={`${eventCount} event${eventCount === 1 ? "" : "s"}`}
                >
                  {eventCount > 3 ? eventCount : "•".repeat(eventCount)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
