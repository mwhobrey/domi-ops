"use client";

import { SlidersHorizontal } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { CalendarLaneGroup, EventCategoryMeta } from "../../lib/calendar-filters";
import { Badge, Button, Input, Select, Sheet } from "../ui";

function FilterPill({
  label,
  color,
  pressed,
  onClick,
  title,
  suffix,
  compact,
}: {
  label: string;
  color: string;
  pressed: boolean;
  onClick: () => void;
  title?: string;
  suffix?: ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex max-w-[10rem] items-center gap-1.5 rounded-full border font-medium transition-colors",
        compact
          ? "px-2 py-0.5 text-[11px]"
          : "px-2.5 py-1 text-xs max-md:min-h-11 max-md:px-3 max-md:py-2",
        pressed
          ? "border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
          : "border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)] opacity-60",
      )}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
    >
      <span
        className={cn("shrink-0 rounded-full", compact ? "h-1.5 w-1.5" : "h-2 w-2")}
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="truncate">{label}</span>
      {suffix}
    </button>
  );
}

export function CalendarFilterBar({
  laneGroups,
  writeLaneGroups,
  hiddenIds,
  categoryGroups,
  hiddenCategoryKeys,
  defaultCalendarId,
  onToggleLaneGroup,
  onToggleCategory,
  onDefaultCalendarChange,
  onShowAllFilters,
}: {
  /** Lanes that have events in the current range (filter pills). */
  laneGroups: CalendarLaneGroup[];
  /** All visible lanes (write-target dropdown). */
  writeLaneGroups: CalendarLaneGroup[];
  hiddenIds: Set<string>;
  categoryGroups?: EventCategoryMeta[];
  hiddenCategoryKeys?: Set<string>;
  defaultCalendarId: string | null;
  onToggleLaneGroup: (group: CalendarLaneGroup) => void;
  onToggleCategory?: (key: string) => void;
  onDefaultCalendarChange: (id: string) => void;
  onShowAllFilters?: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");

  if (writeLaneGroups.length === 0) return null;

  const defaultOptions = writeLaneGroups.flatMap((g) =>
    g.calendarIds.map((id, i) => ({
      id,
      label: g.calendarIds.length > 1 && i > 0 ? `${g.label} (${i + 1})` : g.label,
    })),
  );

  const hiddenLaneCount = laneGroups.filter((g) =>
    g.calendarIds.every((id) => hiddenIds.has(id)),
  ).length;
  const hiddenCategoryCount =
    categoryGroups && hiddenCategoryKeys
      ? categoryGroups.filter((c) => hiddenCategoryKeys.has(c.id)).length
      : 0;
  const activeFilterCount = hiddenLaneCount + hiddenCategoryCount;

  const visibleLaneGroups = laneGroups.filter(
    (g) => !g.calendarIds.every((id) => hiddenIds.has(id)),
  );
  const inlineLanes = visibleLaneGroups.slice(0, 2);
  const overflowLaneCount = Math.max(0, visibleLaneGroups.length - inlineLanes.length);

  const filteredCategories = useMemo(() => {
    if (!categoryGroups) return [];
    const q = categorySearch.trim().toLowerCase();
    if (!q) return categoryGroups;
    return categoryGroups.filter((c) => c.label.toLowerCase().includes(q));
  }, [categoryGroups, categorySearch]);

  function closeSheet() {
    setSheetOpen(false);
    setCategorySearch("");
  }

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="flex shrink-0 items-center gap-1.5">
          <span className="sr-only">Write to calendar</span>
          <span
            className="hidden text-xs font-medium text-[var(--color-text-muted)] sm:inline"
            aria-hidden
          >
            Write to
          </span>
          <Select
            className="!w-auto min-w-[7.5rem] max-w-[11rem] py-1.5 text-xs sm:min-w-[8.5rem]"
            value={defaultCalendarId ?? defaultOptions[0]?.id ?? ""}
            onChange={(e) => onDefaultCalendarChange(e.target.value)}
            aria-label="Write to calendar"
          >
            {defaultOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </Select>
        </label>

        <Button
          size="sm"
          variant="secondary"
          type="button"
          aria-expanded={sheetOpen}
          aria-controls="calendar-filters-sheet"
          onClick={() => setSheetOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden />
          <span>Filters</span>
          {activeFilterCount > 0 ? (
            <Badge tone="accent" className="ml-0.5 tabular-nums">
              {activeFilterCount}
            </Badge>
          ) : null}
        </Button>

        {visibleLaneGroups.length > 0 ? (
          <div
            className="hidden min-w-0 items-center gap-1 lg:flex"
            role="group"
            aria-label="Visible calendars"
          >
            {inlineLanes.map((group) => {
              const off = group.calendarIds.every((id) => hiddenIds.has(id));
              return (
                <FilterPill
                  key={group.key}
                  compact
                  label={group.label}
                  color={group.color ?? "#3b82f6"}
                  pressed={!off}
                  title={
                    group.calendarIds.length > 1
                      ? `${group.calendarIds.length} calendars merged (duplicate imports)`
                      : undefined
                  }
                  suffix={
                    group.calendarIds.length > 1 ? (
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        ×{group.calendarIds.length}
                      </span>
                    ) : undefined
                  }
                  onClick={() => onToggleLaneGroup(group)}
                />
              );
            })}
            {overflowLaneCount > 0 ? (
              <button
                type="button"
                className="rounded-full px-1.5 py-0.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-text)]"
                onClick={() => setSheetOpen(true)}
              >
                +{overflowLaneCount}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <Sheet
        open={sheetOpen}
        onClose={closeSheet}
        title="Calendar filters"
        description="Choose which calendars and categories appear in the grid."
        className="max-w-lg"
      >
        <div id="calendar-filters-sheet" className="space-y-6 px-6 py-4">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-[var(--color-text-muted)]">Write to calendar</span>
            <Select
              value={defaultCalendarId ?? defaultOptions[0]?.id ?? ""}
              onChange={(e) => onDefaultCalendarChange(e.target.value)}
            >
              {defaultOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </label>

          {activeFilterCount > 0 && onShowAllFilters ? (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" type="button" onClick={onShowAllFilters}>
                Show all calendars &amp; categories
              </Button>
            </div>
          ) : null}

          {laneGroups.length > 0 ? (
            <section aria-labelledby="calendar-filter-lanes-heading">
              <h3
                id="calendar-filter-lanes-heading"
                className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]"
              >
                Show calendars
              </h3>
              <div className="flex flex-wrap gap-2">
                {laneGroups.map((group) => {
                  const off = group.calendarIds.every((id) => hiddenIds.has(id));
                  return (
                    <FilterPill
                      key={group.key}
                      label={group.label}
                      color={group.color ?? "#3b82f6"}
                      pressed={!off}
                      title={
                        group.calendarIds.length > 1
                          ? `${group.calendarIds.length} calendars merged (duplicate imports)`
                          : undefined
                      }
                      suffix={
                        group.calendarIds.length > 1 ? (
                          <span className="text-[10px] text-[var(--color-text-muted)]">
                            ×{group.calendarIds.length}
                          </span>
                        ) : undefined
                      }
                      onClick={() => onToggleLaneGroup(group)}
                    />
                  );
                })}
              </div>
            </section>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">
              No events in this date range — use Write to calendar when creating.
            </p>
          )}

          {categoryGroups &&
          categoryGroups.length > 0 &&
          onToggleCategory &&
          hiddenCategoryKeys ? (
            <section aria-labelledby="calendar-filter-categories-heading">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3
                  id="calendar-filter-categories-heading"
                  className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]"
                >
                  Categories
                </h3>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {categoryGroups.length - hiddenCategoryCount} of {categoryGroups.length} visible
                </span>
              </div>
              {categoryGroups.length > 6 ? (
                <Input
                  className="mb-3"
                  placeholder="Search categories…"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  aria-label="Search categories"
                />
              ) : null}
              <div className="flex max-h-[min(40vh,16rem)] flex-wrap gap-2 overflow-y-auto overscroll-contain">
                {filteredCategories.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">No categories match.</p>
                ) : (
                  filteredCategories.map((cat) => {
                    const off = hiddenCategoryKeys.has(cat.id);
                    return (
                      <FilterPill
                        key={cat.id}
                        label={cat.label}
                        color={cat.color ?? "#6366f1"}
                        pressed={!off}
                        onClick={() => onToggleCategory(cat.id)}
                      />
                    );
                  })
                )}
              </div>
            </section>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
