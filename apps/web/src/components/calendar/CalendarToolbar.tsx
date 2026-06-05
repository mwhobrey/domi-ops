"use client";

import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { CalendarViewMode } from "../../lib/calendar-utils";
import { Button } from "../ui";

const VIEW_LABELS: { id: CalendarViewMode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
  { id: "agenda", label: "Agenda" },
];

export function CalendarToolbar({
  viewMode,
  onViewChange,
  periodLabel,
  onPrev,
  onToday,
  onNext,
  showWeekDay = true,
  loading,
  trailing,
  className,
}: {
  viewMode: CalendarViewMode;
  onViewChange: (v: CalendarViewMode) => void;
  periodLabel: string;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  /** Hide week/day toggles on mobile */
  showWeekDay?: boolean;
  loading?: boolean;
  trailing?: ReactNode;
  className?: string;
}) {
  const visibleViews = showWeekDay
    ? VIEW_LABELS
    : VIEW_LABELS.filter((v) => v.id === "month" || v.id === "agenda");

  return (
    <div className={cn("flex flex-wrap items-center gap-2 sm:gap-3", className)}>
      <div
        className="flex rounded-[var(--radius-lg)] border border-[var(--color-border)] p-0.5"
        role="tablist"
        aria-label="Calendar view"
      >
        {visibleViews.map(({ id, label }) => (
          <Button
            key={id}
            size="sm"
            variant={viewMode === id ? "primary" : "ghost"}
            role="tab"
            aria-selected={viewMode === id}
            onClick={() => onViewChange(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" type="button" onClick={onPrev}>
          Prev
        </Button>
        <Button variant="secondary" size="sm" type="button" onClick={onToday}>
          Today
        </Button>
        <Button variant="secondary" size="sm" type="button" onClick={onNext}>
          Next
        </Button>
        <span className="text-sm text-[var(--color-text-muted)]">{periodLabel}</span>
        {loading && <span className="text-sm text-[var(--color-text-muted)]">Loading…</span>}
      </div>
      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
}
