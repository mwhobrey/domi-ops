"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type {
  CalendarCreateDraft,
  CalendarEventView,
  RepeatFreq,
} from "../lib/calendar-utils";
import { eventInteractionTitle, formatDateLocal } from "../lib/calendar-utils";
import {
  RecurringScopeSheet,
  type RecurringScope,
} from "./calendar/RecurringScopeSheet";
import { normalizeEventDescriptionForSave } from "../lib/event-html";
import {
  Alert,
  Button,
  Checkbox,
  ColorField,
  ConfirmDialog,
  Input,
  RichTextContent,
  RichTextEditor,
  Select,
  Sheet,
} from "./ui";

type EventCategory = {
  id: string;
  calendarId: string;
  key: string;
  label: string;
  color: string | null;
  isDefault?: boolean;
};
type HouseholdCalendar = { id: string; name: string };

const REMINDER_OPTIONS = [
  { value: 15, label: "15 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
];

const REPEAT_OPTIONS: { value: RepeatFreq; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-label text-[var(--color-text-muted)]">{title}</h3>
      {children}
    </section>
  );
}

export function CalendarEventSheet({
  open,
  selected,
  createDraft,
  defaultCalendarId,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  selected: CalendarEventView | null;
  createDraft?: CalendarCreateDraft | null;
  defaultCalendarId?: string | null;
  onClose: () => void;
  onSaved: (ev: CalendarEventView, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [color, setColor] = useState("#3b82f6");
  const [categoryKey, setCategoryKey] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [repeat, setRepeat] = useState<RepeatFreq>("none");
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([]);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [calendars, setCalendars] = useState<HouseholdCalendar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [recurringDeleteOpen, setRecurringDeleteOpen] = useState(false);

  const loadMeta = useCallback(async () => {
    try {
      const calRes = await apiClient.get<{ calendars: { id: string; name: string }[] }>(
        "/api/calendar/calendars",
      );
      setCalendars(calRes.calendars.map((c) => ({ id: c.id, name: c.name })));
    } catch {
      /* optional */
    }
  }, []);

  const loadCategoriesForCalendar = useCallback(async (calId: string) => {
    if (!calId) {
      setCategories([]);
      setCategoriesLoading(false);
      return;
    }
    setCategoriesLoading(true);
    try {
      const catRes = await apiClient.get<{ categories: EventCategory[] }>(
        `/api/calendar/event-categories?calendarId=${encodeURIComponent(calId)}`,
      );
      setCategories(catRes.categories);
    } catch {
      setCategories([]);
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadMeta();
  }, [open, loadMeta]);

  useEffect(() => {
    if (!open) return;
    const calId = calendarId || defaultCalendarId || "";
    void loadCategoriesForCalendar(calId);
  }, [open, calendarId, defaultCalendarId, loadCategoriesForCalendar]);

  useEffect(() => {
    if (categoriesLoading || !categoryKey) return;
    if (!categories.some((c) => c.key === categoryKey)) {
      setCategoryKey("");
    }
  }, [categories, categoryKey, categoriesLoading]);

  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setDescription(selected.description ?? "");
      setStartDate(selected.startDate);
      setEndDate(selected.endDate ?? "");
      setStartTime(selected.startTime ?? "09:00");
      setEndTime(selected.endTime ?? "10:00");
      setAllDay(selected.allDay);
      setColor(selected.color ?? "#3b82f6");
      setCategoryKey(selected.categoryKey ?? "");
      setCalendarId(selected.calendarId);
      setTimeZone(selected.timeZone ?? "");
      setRepeat(selected.recurringRuleId ? "weekly" : "none");
      setReminderOffsets(selected.reminderOffsets ?? []);
    } else if (open) {
      setTitle("");
      setDescription("");
      if (createDraft) {
        setStartDate(createDraft.startDate);
        setStartTime(createDraft.startTime);
        setAllDay(createDraft.allDay);
      } else {
        setStartDate(formatDateLocal(new Date()));
        setStartTime("09:00");
        setAllDay(false);
      }
      setEndDate("");
      setEndTime("10:00");
      setColor("#3b82f6");
      setCategoryKey("");
      setCalendarId(defaultCalendarId ?? "");
      setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      setRepeat("none");
      setReminderOffsets([]);
    }
    setError(null);
  }, [selected, open, createDraft, defaultCalendarId]);

  function buildPayload() {
    const payload: Record<string, unknown> = {
      title,
      description: normalizeEventDescriptionForSave(description),
      startDate,
      endDate: endDate || undefined,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime,
      allDay,
      color: categoryKey ? undefined : color,
      categoryKey: categoryKey || undefined,
      calendarId: calendarId || undefined,
      timeZone: timeZone || undefined,
      reminderOffsets,
    };
    if (!selected && repeat !== "none") {
      payload.repeatRule = { freq: repeat };
    }
    return payload;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (endDate && endDate < startDate) {
      setError("End date must be on or after start date.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (selected) {
        const data = await apiClient.patch<{ event: CalendarEventView }>(
          `/api/calendar/events/${selected.id}`,
          buildPayload(),
        );
        onSaved({ ...selected, ...data.event }, false);
      } else {
        const data = await apiClient.post<{ event: CalendarEventView }>(
          "/api/calendar/events",
          buildPayload(),
        );
        onSaved(data.event, true);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function remove(scope?: RecurringScope) {
    if (!selected) return;
    setConfirmDelete(false);
    setRecurringDeleteOpen(false);
    setLoading(true);
    try {
      const qs = scope ? `?recurringScope=${scope}` : "";
      await apiClient.delete(`/api/calendar/events/${selected.id}${qs}`);
      onDeleted(selected.id);
      onClose();
    } catch {
      setError("Delete failed");
    } finally {
      setLoading(false);
    }
  }

  async function duplicate() {
    if (!selected) return;
    setLoading(true);
    try {
      const data = await apiClient.post<{ event: CalendarEventView }>(
        `/api/calendar/events/${selected.id}/duplicate`,
        {},
      );
      onSaved(data.event, true);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Duplicate failed");
    } finally {
      setLoading(false);
    }
  }

  function toggleReminder(offset: number) {
    setReminderOffsets((prev) =>
      prev.includes(offset) ? prev.filter((o) => o !== offset) : [...prev, offset],
    );
  }

  if (!open) return null;

  const readOnly = selected?.editable === false;
  const syncHint = selected ? eventInteractionTitle(selected) : undefined;

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={selected ? "Edit event" : "New event"}
        description={
          readOnly
            ? "This event is read-only on the grid."
            : selected
              ? "Update details, calendar, and reminders."
              : "Add to your household calendar."
        }
      >
        <div className="px-6 pb-7 pt-2">
          {selected?.syncStatus === "pending" && (
            <Alert variant="info" className="mb-5">
              Changes are syncing to Google Calendar.
            </Alert>
          )}
          {syncHint && selected?.syncStatus !== "pending" && (
            <p className="mb-5 text-sm leading-relaxed text-[var(--color-text-muted)]">{syncHint}</p>
          )}
          {error && (
            <Alert variant="error" className="mb-5">
              {error}
            </Alert>
          )}

          <form className="space-y-7" onSubmit={save}>
            <FormSection title="Details">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Title</span>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  disabled={readOnly}
                  autoFocus={!selected}
                />
              </label>
              <div className="space-y-1.5 text-sm">
                <span className="font-medium">Description</span>
                {readOnly ? (
                  description.trim() ? (
                    <RichTextContent html={description} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]/40 px-3 py-2.5" />
                  ) : (
                    <p className="text-sm text-[var(--color-text-muted)]">No description</p>
                  )
                ) : (
                  <RichTextEditor
                    value={description}
                    onChange={setDescription}
                    placeholder="Optional notes, links, lists…"
                  />
                )}
              </div>
            </FormSection>

            <FormSection title="When">
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">Start date</span>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    disabled={readOnly}
                  />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">End date</span>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    disabled={readOnly}
                  />
                </label>
              </div>
              <Checkbox
                label="All day"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                disabled={readOnly}
              />
              {!allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1.5 text-sm">
                    <span className="font-medium">Start time</span>
                    <Input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      disabled={readOnly}
                    />
                  </label>
                  <label className="block space-y-1.5 text-sm">
                    <span className="font-medium">End time</span>
                    <Input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      disabled={readOnly}
                    />
                  </label>
                </div>
              )}
              <details className="rounded-[var(--radius-md)] border border-[var(--color-border)]/80 bg-[var(--color-surface-subtle)]/40 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-muted)] marker:content-none hover:text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
                  Time zone
                </summary>
                <label className="mt-3 block space-y-1.5 text-sm">
                  <Input
                    value={timeZone}
                    onChange={(e) => setTimeZone(e.target.value)}
                    disabled={readOnly}
                    placeholder="America/Chicago"
                    aria-label="Time zone"
                  />
                </label>
              </details>
            </FormSection>

            <FormSection title="Calendar & labels">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Calendar</span>
                <Select
                  value={calendarId}
                  onChange={(e) => {
                    setCalendarId(e.target.value);
                    setCategoryKey("");
                  }}
                  disabled={readOnly}
                >
                  <option value="">Default calendar</option>
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Category</span>
                <Select
                  value={categoryKey}
                  onChange={(e) => setCategoryKey(e.target.value)}
                  disabled={readOnly || categoriesLoading || !(calendarId || defaultCalendarId)}
                >
                  <option value="">
                    {categoriesLoading
                      ? "Loading…"
                      : !(calendarId || defaultCalendarId)
                        ? "Select a calendar first"
                        : "None"}
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.key}>
                      {c.label}
                      {c.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </Select>
              </label>
              {!categoryKey ? (
                <div className="space-y-1.5 text-sm">
                  <span className="font-medium">Color</span>
                  <ColorField
                    compact
                    ariaLabel="Event color"
                    value={color}
                    onChange={setColor}
                    disabled={readOnly}
                  />
                </div>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Color comes from the selected category.
                </p>
              )}
            </FormSection>

            {!selected && (
              <FormSection title="Repeat">
                <Select
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value as RepeatFreq)}
                  disabled={readOnly}
                >
                  {REPEAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </FormSection>
            )}

            <fieldset className="space-y-2.5">
              <legend className="text-label mb-3 text-[var(--color-text-muted)]">Reminders</legend>
              {REMINDER_OPTIONS.map((o) => (
                <Checkbox
                  key={o.value}
                  label={o.label}
                  checked={reminderOffsets.includes(o.value)}
                  onChange={() => toggleReminder(o.value)}
                  disabled={readOnly}
                />
              ))}
            </fieldset>

            <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)]/60 pt-6">
              {!readOnly && (
                <Button type="submit" loading={loading} className="min-w-[5.5rem]">
                  {selected ? "Save" : "Create"}
                </Button>
              )}
              {selected && !readOnly && (
                <>
                  <Button type="button" variant="secondary" onClick={() => void duplicate()}>
                    Duplicate
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() =>
                      selected.recurringRuleId
                        ? setRecurringDeleteOpen(true)
                        : setConfirmDelete(true)
                    }
                  >
                    Delete
                  </Button>
                </>
              )}
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete event?"
        message="This cannot be undone."
        confirmLabel="Delete"
        loading={loading}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
      <RecurringScopeSheet
        open={recurringDeleteOpen}
        title={selected?.title ?? "Event"}
        onCancel={() => setRecurringDeleteOpen(false)}
        onChoose={(scope) => void remove(scope)}
      />
    </>
  );
}
