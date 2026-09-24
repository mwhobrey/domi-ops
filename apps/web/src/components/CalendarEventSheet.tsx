"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type {
  CalendarCreateDraft,
  CalendarEventView,
  RepeatEnds,
  RepeatFreq,
} from "../lib/calendar-utils";
import {
  buildRepeatRule,
  eventInteractionTitle,
  repeatUnitLabel,
} from "../lib/calendar-utils";
import { cn } from "../lib/cn";
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
import { ScheduleConflictChecker } from "./ScheduleConflictChecker";
import { eventFormToConflictFormState } from "../lib/schedule-conflict";
import { adjustTimedEventEndOnStartChange } from "../lib/event-form-times";
import { useHouseholdToday } from "./HouseholdTimeProvider";

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
  { value: 5, label: "5 minutes before" },
  { value: 10, label: "10 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 180, label: "3 hours before" },
  { value: 1440, label: "1 day before" },
  { value: 2880, label: "2 days before" },
  { value: 10080, label: "1 week before" },
];

const REPEAT_OPTIONS: { value: RepeatFreq; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

export type EventMemberOption = { memberId: string; label: string };

let supportedTimeZones: string[] | null = null;

/** IANA zones the browser knows, plus whatever the event already has saved. */
function timeZoneOptions(current: string): string[] {
  if (!supportedTimeZones) {
    try {
      supportedTimeZones = Intl.supportedValuesOf("timeZone");
    } catch {
      supportedTimeZones = [
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Phoenix",
        "America/Los_Angeles",
        "America/Anchorage",
        "Pacific/Honolulu",
        "UTC",
      ];
    }
  }
  return current && !supportedTimeZones.includes(current)
    ? [current, ...supportedTimeZones]
    : supportedTimeZones;
}

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
  members = [],
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  selected: CalendarEventView | null;
  createDraft?: CalendarCreateDraft | null;
  defaultCalendarId?: string | null;
  /** Household roster for "Who's it for". */
  members?: EventMemberOption[];
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
  const [driveBufferBefore, setDriveBufferBefore] = useState("");
  const [driveBufferAfter, setDriveBufferAfter] = useState("");
  const [repeat, setRepeat] = useState<RepeatFreq>("none");
  const [repeatInterval, setRepeatInterval] = useState("1");
  const [repeatEnds, setRepeatEnds] = useState<RepeatEnds>("never");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [repeatCount, setRepeatCount] = useState("10");
  const [location, setLocation] = useState("");
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([]);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  /** Calendar the current `categories` belong to — gates applying its default category once. */
  const [categoriesCalId, setCategoriesCalId] = useState<string | null>(null);
  const [defaultCategoryAppliedFor, setDefaultCategoryAppliedFor] = useState<string | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [calendars, setCalendars] = useState<HouseholdCalendar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [recurringDeleteOpen, setRecurringDeleteOpen] = useState(false);
  const [conflictCheckOpen, setConflictCheckOpen] = useState(false);
  const [conflictCheckKey, setConflictCheckKey] = useState(0);
  // New events default to the household's today; a ref so the reset effect doesn't re-run
  // (and clear the form) when the date rolls over.
  const today = useHouseholdToday();
  const todayRef = useRef(today);
  todayRef.current = today;

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
      setCategoriesCalId(calId);
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

  // New events start in the calendar's default category (the option labeled "(default)").
  useEffect(() => {
    if (!open) {
      setDefaultCategoryAppliedFor(null);
      return;
    }
    if (selected || categoriesLoading) return;
    const calId = calendarId || defaultCalendarId || "";
    if (!calId || categoriesCalId !== calId || defaultCategoryAppliedFor === calId) return;
    setDefaultCategoryAppliedFor(calId);
    const fallback = categories.find((c) => c.isDefault);
    if (fallback && !categoryKey) setCategoryKey(fallback.key);
  }, [
    open,
    selected,
    categoriesLoading,
    calendarId,
    defaultCalendarId,
    categoriesCalId,
    defaultCategoryAppliedFor,
    categories,
    categoryKey,
  ]);

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
      setDriveBufferBefore(
        selected.driveBufferBeforeMinutes != null ? String(selected.driveBufferBeforeMinutes) : "",
      );
      setDriveBufferAfter(
        selected.driveBufferAfterMinutes != null ? String(selected.driveBufferAfterMinutes) : "",
      );
      setRepeat(selected.recurringRuleId ? "weekly" : "none");
      setReminderOffsets(selected.reminderOffsets ?? []);
      setLocation(selected.location ?? "");
      setAttendeeIds(selected.attendeeMemberIds ?? []);
    } else if (open) {
      setTitle("");
      setDescription("");
      if (createDraft) {
        setStartDate(createDraft.startDate);
        setStartTime(createDraft.startTime);
        setAllDay(createDraft.allDay);
        setEndDate(createDraft.endDate ?? "");
        setEndTime(createDraft.endTime ?? "10:00");
        setDriveBufferBefore(
          createDraft.driveBufferBeforeMinutes != null
            ? String(createDraft.driveBufferBeforeMinutes)
            : "",
        );
        setDriveBufferAfter(
          createDraft.driveBufferAfterMinutes != null
            ? String(createDraft.driveBufferAfterMinutes)
            : "",
        );
      } else {
        setStartDate(todayRef.current);
        setStartTime("09:00");
        setAllDay(false);
      }
      setEndDate("");
      setEndTime("10:00");
      setColor("#3b82f6");
      setCategoryKey("");
      setCalendarId(defaultCalendarId ?? "");
      setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      setDriveBufferBefore("");
      setDriveBufferAfter("");
      setRepeat("none");
      setRepeatInterval("1");
      setRepeatEnds("never");
      setRepeatUntil("");
      setRepeatCount("10");
      setReminderOffsets([]);
      setLocation("");
      setAttendeeIds([]);
    }
    setError(null);
    setConflictCheckOpen(false);
  }, [selected, open, createDraft, defaultCalendarId]);

  const conflictInitialForm = useMemo(() => {
    if (!conflictCheckOpen) return null;
    return eventFormToConflictFormState({
      startDate,
      endDate,
      startTime,
      endTime,
      allDay,
      driveBufferBefore,
      driveBufferAfter,
    });
  }, [
    conflictCheckOpen,
    startDate,
    endDate,
    startTime,
    endTime,
    allDay,
    driveBufferBefore,
    driveBufferAfter,
    conflictCheckKey,
  ]);

  // Buffers don't carry across a recurring series yet, so they're hidden (and sent as null) there.
  const bufferHidden = allDay || repeat !== "none";

  function applyTimedEndAfterStartChange(
    previousStartDate: string,
    previousStartTime: string,
    newStartDate: string,
    newStartTime: string,
  ) {
    if (allDay) return;
    const adjusted = adjustTimedEventEndOnStartChange({
      startDate,
      endDate,
      previousStartDate,
      previousStartTime,
      newStartDate,
      newStartTime,
      endTime,
    });
    setEndTime(adjusted.endTime);
    setEndDate(adjusted.endDate === newStartDate ? "" : adjusted.endDate);
  }

  function buildPayload() {
    const payload: Record<string, unknown> = {
      title,
      description: normalizeEventDescriptionForSave(description),
      startDate,
      endDate: endDate || null,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime,
      allDay,
      color: categoryKey ? undefined : color,
      categoryKey: categoryKey || undefined,
      calendarId: calendarId || undefined,
      timeZone: timeZone || undefined,
      driveBufferBeforeMinutes: bufferHidden || !driveBufferBefore ? null : Number(driveBufferBefore),
      driveBufferAfterMinutes: bufferHidden || !driveBufferAfter ? null : Number(driveBufferAfter),
      reminderOffsets,
      location: location.trim() || null,
      attendeeMemberIds: attendeeIds,
    };
    return payload;
  }

  function toggleAttendee(memberId: string) {
    setAttendeeIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId],
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (endDate && endDate < startDate) {
      setError("End date must be on or after start date.");
      return;
    }
    const payload = buildPayload();
    if (!selected) {
      const repeatResult = buildRepeatRule({
        freq: repeat,
        interval: repeatInterval,
        ends: repeatEnds,
        until: repeatUntil,
        count: repeatCount,
        startDate,
      });
      if ("error" in repeatResult) {
        setError(repeatResult.error);
        return;
      }
      if (repeatResult.rule) payload.repeatRule = repeatResult.rule;
    }
    setLoading(true);
    setError(null);
    try {
      if (selected) {
        const data = await apiClient.patch<{ event: CalendarEventView }>(
          `/api/calendar/events/${selected.id}`,
          payload,
        );
        onSaved({ ...selected, ...data.event }, false);
      } else {
        const data = await apiClient.post<{ event: CalendarEventView }>(
          "/api/calendar/events",
          payload,
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
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Location</span>
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  maxLength={512}
                  placeholder="Optional"
                  disabled={readOnly}
                />
              </label>
              {members.length > 0 && (
                <fieldset className="space-y-1.5 text-sm" disabled={readOnly}>
                  <legend className="font-medium">Who&apos;s it for</legend>
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => {
                      const on = attendeeIds.includes(m.memberId);
                      return (
                        <button
                          key={m.memberId}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleAttendee(m.memberId)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-sm transition",
                            on
                              ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/20",
                          )}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">Start date</span>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      const next = e.target.value;
                      applyTimedEndAfterStartChange(startDate, startTime, next, startTime);
                      setStartDate(next);
                    }}
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block space-y-1.5 text-sm">
                    <span className="font-medium">Start time</span>
                    <Input
                      type="time"
                      value={startTime}
                      onChange={(e) => {
                        const next = e.target.value;
                        applyTimedEndAfterStartChange(startDate, startTime, startDate, next);
                        setStartTime(next);
                      }}
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
                  Time zone{timeZone ? ` · ${timeZone.replace(/_/g, " ")}` : ""}
                </summary>
                <label className="mt-3 block space-y-1.5 text-sm">
                  <Select
                    value={timeZone}
                    onChange={(e) => setTimeZone(e.target.value)}
                    disabled={readOnly}
                    aria-label="Time zone"
                  >
                    <option value="">Household default</option>
                    {timeZoneOptions(timeZone).map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                </label>
              </details>
              {!selected && !readOnly && (
                <div className="space-y-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setConflictCheckKey((k) => k + 1);
                      setConflictCheckOpen(true);
                    }}
                  >
                    Check schedule conflicts
                  </Button>
                  {conflictCheckOpen && conflictInitialForm && (
                    <ScheduleConflictChecker
                      embedded
                      autoCheck
                      initialForm={conflictInitialForm}
                      showCreateEventAction={false}
                    />
                  )}
                </div>
              )}
              {!bufferHidden && (
                <details className="rounded-[var(--radius-md)] border border-[var(--color-border)]/80 bg-[var(--color-surface-subtle)]/40 px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-muted)] marker:content-none hover:text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
                    Drive buffer
                  </summary>
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    Manually-entered travel time to pad around this event in the Schedule Conflict
                    Checker. Not calculated automatically.
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block space-y-1.5 text-sm">
                      <span className="font-medium">Minutes before</span>
                      <Input
                        type="number"
                        min={0}
                        max={1440}
                        step={1}
                        value={driveBufferBefore}
                        onChange={(e) => setDriveBufferBefore(e.target.value)}
                        disabled={readOnly}
                        placeholder="0"
                      />
                    </label>
                    <label className="block space-y-1.5 text-sm">
                      <span className="font-medium">Minutes after</span>
                      <Input
                        type="number"
                        min={0}
                        max={1440}
                        step={1}
                        value={driveBufferAfter}
                        onChange={(e) => setDriveBufferAfter(e.target.value)}
                        disabled={readOnly}
                        placeholder="0"
                      />
                    </label>
                  </div>
                </details>
              )}
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
                    inlinePresets
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
                  aria-label="Repeat"
                >
                  {REPEAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                {repeat !== "none" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block space-y-1.5 text-sm">
                      <span className="font-medium">Every</span>
                      <span className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={99}
                          step={1}
                          className="w-20"
                          value={repeatInterval}
                          onChange={(e) => setRepeatInterval(e.target.value)}
                          aria-label="Repeat every"
                        />
                        <span className="text-[var(--color-text-muted)]">
                          {repeatUnitLabel(repeat, Number(repeatInterval) || 1)}
                        </span>
                      </span>
                    </label>
                    <label className="block space-y-1.5 text-sm">
                      <span className="font-medium">Ends</span>
                      <Select
                        value={repeatEnds}
                        onChange={(e) => setRepeatEnds(e.target.value as RepeatEnds)}
                        aria-label="Repeat ends"
                      >
                        <option value="never">Never</option>
                        <option value="on">On a date</option>
                        <option value="after">After a number of times</option>
                      </Select>
                    </label>
                    {repeatEnds === "on" && (
                      <label className="block space-y-1.5 text-sm sm:col-start-2">
                        <span className="font-medium">Last date</span>
                        <Input
                          type="date"
                          min={startDate}
                          value={repeatUntil}
                          onChange={(e) => setRepeatUntil(e.target.value)}
                        />
                      </label>
                    )}
                    {repeatEnds === "after" && (
                      <label className="block space-y-1.5 text-sm sm:col-start-2">
                        <span className="font-medium">Occurrences</span>
                        <Input
                          type="number"
                          min={1}
                          max={999}
                          step={1}
                          value={repeatCount}
                          onChange={(e) => setRepeatCount(e.target.value)}
                        />
                      </label>
                    )}
                  </div>
                )}
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
