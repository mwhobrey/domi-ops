"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../../lib/client-api";
import { Button, ColorField, Input } from "../ui";

type CalendarRow = { id: string; name: string; color: string | null };
type Category = {
  id: string;
  calendarId: string;
  key: string;
  label: string;
  color: string | null;
  isDefault: boolean;
};

export function CalendarCategoriesPanel({ active }: { active: boolean }) {
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>("");
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [calRes, catRes] = await Promise.all([
        apiClient.get<{ calendars: CalendarRow[] }>("/api/calendar/calendars"),
        apiClient.get<{ categories: Category[] }>("/api/calendar/event-categories"),
      ]);
      const cals = calRes.calendars.filter((c) => !("archived" in c && c.archived)).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      setCalendars(cals);
      setCategories(catRes.categories);
      setSelectedCalendarId((prev) => prev || cals[0]?.id || "");
    } catch {
      /* keep */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const selectedCal = calendars.find((c) => c.id === selectedCalendarId);
  const calCategories = categories
    .filter((c) => c.calendarId === selectedCalendarId)
    .sort((a, b) => a.label.localeCompare(b.label));

  async function create() {
    const label = newLabel.trim();
    if (!label || !selectedCalendarId) return;
    await apiClient.post("/api/calendar/event-categories", {
      calendarId: selectedCalendarId,
      label,
      color: newColor,
    });
    setNewLabel("");
    await load();
  }

  async function updateCategory(id: string, patch: { label?: string; color?: string | null }) {
    await apiClient.patch(`/api/calendar/event-categories/${id}`, patch);
    await load();
  }

  async function removeCategory(id: string) {
    await apiClient.delete(`/api/calendar/event-categories/${id}`);
    await load();
  }

  if (!active) return null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-muted)]">
        Categories belong to a calendar. Event color comes from its category — define buckets like
        &ldquo;Mike — doctor&rdquo; vs &ldquo;Spouse — doctor&rdquo; per calendar.
      </p>

      {calendars.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">Add a calendar first.</p>
      ) : (
        <>
          <label className="block text-sm">
            <span className="font-medium">Calendar</span>
            <select
              className="mt-1.5 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              value={selectedCalendarId}
              onChange={(e) => setSelectedCalendarId(e.target.value)}
            >
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-0 flex-1"
              placeholder="New category label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <ColorField
              compact
              ariaLabel="Category color"
              value={newColor}
              onChange={setNewColor}
            />
            <Button size="sm" type="button" disabled={!selectedCalendarId} onClick={() => void create()}>
              Add
            </Button>
          </div>

          {loading && calCategories.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
          ) : (
            <ul className="space-y-2">
              {calCategories.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)]/80 px-3 py-2"
                >
                  <ColorField
                    compact
                    ariaLabel={`Color for ${c.label}`}
                    value={c.color ?? selectedCal?.color ?? "#3b82f6"}
                    disabled={c.isDefault}
                    onChange={(hex) => void updateCategory(c.id, { color: hex })}
                  />
                  <Input
                    className="min-w-0 flex-1"
                    value={c.label}
                    disabled={c.isDefault}
                    onChange={(e) =>
                      setCategories((prev) =>
                        prev.map((row) =>
                          row.id === c.id ? { ...row, label: e.target.value } : row,
                        ),
                      )
                    }
                    onBlur={(e) => {
                      const label = e.target.value.trim();
                      if (label && label !== c.label) void updateCategory(c.id, { label });
                    }}
                  />
                  {c.isDefault ? (
                    <span className="text-xs text-[var(--color-text-muted)]">Default</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => void removeCategory(c.id)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
