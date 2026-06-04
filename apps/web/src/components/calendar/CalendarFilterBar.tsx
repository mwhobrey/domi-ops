"use client";

import { cn } from "../../lib/cn";
import type { CalendarLaneGroup, EventCategoryMeta } from "../../lib/calendar-filters";
import { Select } from "../ui";

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
}) {
  if (writeLaneGroups.length === 0) return null;

  const defaultOptions = writeLaneGroups.flatMap((g) =>
    g.calendarIds.map((id, i) => ({
      id,
      label: g.calendarIds.length > 1 && i > 0 ? `${g.label} (${i + 1})` : g.label,
    })),
  );

  return (
    <div className="mb-4 space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-muted)]/30 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[10rem] flex-1 space-y-1 text-sm">
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
      </div>
      {laneGroups.length > 0 ? (
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          Show calendars
        </p>
        <div className="flex flex-wrap gap-2">
          {laneGroups.map((group) => {
            const off = group.calendarIds.every((id) => hiddenIds.has(id));
            const bg = group.color ?? "#3b82f6";
            return (
              <button
                key={group.key}
                type="button"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  off
                    ? "border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)] opacity-60"
                    : "border-[var(--color-border)] bg-[var(--color-surface-elevated)]",
                )}
                aria-pressed={!off}
                title={
                  group.calendarIds.length > 1
                    ? `${group.calendarIds.length} calendars merged (duplicate imports)`
                    : undefined
                }
                onClick={() => onToggleLaneGroup(group)}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: bg }}
                  aria-hidden
                />
                {group.label}
                {group.calendarIds.length > 1 && (
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    ×{group.calendarIds.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)]">
          No events in this date range — use Write to calendar when creating.
        </p>
      )}
      {categoryGroups && categoryGroups.length > 0 && onToggleCategory && hiddenCategoryKeys && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Categories
          </p>
          <div className="flex flex-wrap gap-2">
            {categoryGroups.map((cat) => {
              const off = hiddenCategoryKeys.has(cat.id);
              const bg = cat.color ?? "#6366f1";
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    off
                      ? "border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)] opacity-60"
                      : "border-[var(--color-border)] bg-[var(--color-surface-elevated)]",
                  )}
                  aria-pressed={!off}
                  onClick={() => onToggleCategory(cat.id)}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: bg }}
                    aria-hidden
                  />
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
