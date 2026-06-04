"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { eventOverlapsDate } from "../../lib/calendar-event-span";
import type { CalendarEventView } from "../../lib/calendar-utils";
import { monthGrid, parseLocalDate } from "../../lib/calendar-utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarMonthView({
  monthStart,
  events,
  compact = false,
  onDaySelect,
}: {
  monthStart: Date;
  events: CalendarEventView[];
  compact?: boolean;
  onDaySelect: (date: string) => void;
}) {
  const cells = useMemo(() => monthGrid(monthStart), [monthStart]);
  const eventCountByDate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cell of cells) {
      if (!cell.inMonth) continue;
      const n = events.filter((e) => eventOverlapsDate(e, cell.date)).length;
      if (n > 0) counts.set(cell.date, n);
    }
    return counts;
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
          const eventCount = eventCountByDate.get(cell.date) ?? 0;
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
                  ? `${parseLocalDate(cell.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}${hasEvents ? ", has events" : ""}`
                  : undefined
              }
              onFocus={() => cell.inMonth && setFocusedIndex(index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onClick={() => {
                if (!cell.inMonth) return;
                onDaySelect(cell.date);
              }}
              className={cn(
                "relative flex flex-col items-center justify-start rounded-[var(--radius-md)] border transition",
                compact
                  ? "min-h-[2rem] p-0.5 text-xs sm:min-h-[2.35rem]"
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
                  cell.isToday && cell.inMonth && "text-[var(--color-accent)]",
                )}
              >
                {cell.day}
              </span>
              {hasEvents && cell.inMonth && (
                <span
                  className="mt-auto text-[10px] font-medium tabular-nums text-[var(--color-accent)]"
                  title={`${eventCount} event${eventCount === 1 ? "" : "s"}`}
                >
                  {eventCount > 3 ? "•••" : "•".repeat(Math.min(eventCount, 3))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
