"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, apiClient } from "../lib/client-api";
import { formatDateLocal } from "../lib/calendar-utils";
import type { CalendarCreateDraft } from "../lib/calendar-utils";
import {
  buildConflictCheckParams,
  calendarCreateDraftToSearchParams,
  createDraftFromCheckedWindow,
  type ScheduleConflictCheckedWindow,
  type ScheduleConflictFormState,
} from "../lib/schedule-conflict";
import {
  Alert,
  AnchorButton,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  SectionHeader,
  Select,
  Skeleton,
} from "./ui";

type ScheduleConflictEvent = {
  id: string;
  title: string;
  color: string | null;
  startDate: string;
  endDate?: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
};

type ScheduleConflictEventDto = {
  event: ScheduleConflictEvent;
  severity: "red" | "yellow";
  reason: "literal_overlap" | "event_buffer_encroachment" | "check_buffer_encroachment";
};

type ScheduleConflictMedDto = {
  id: string;
  title: string;
  scheduledAt: string;
  deepLink: string;
};

type ScheduleConflictResponse = {
  checkedWindow: ScheduleConflictCheckedWindow;
  conflicts: {
    red: ScheduleConflictEventDto[];
    yellow: ScheduleConflictEventDto[];
  };
  meds: ScheduleConflictMedDto[];
  summary: { redCount: number; yellowCount: number; medCount: number };
};

function formatEventWhen(ev: ScheduleConflictEvent): string {
  if (ev.allDay) return "All day";
  if (!ev.startTime) return "Timed";
  const time = (t: string) => {
    const [hStr, mStr] = t.split(":");
    const h = Number(hStr);
    if (Number.isNaN(h)) return t;
    const suffix = h >= 12 ? "p" : "a";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${mStr ?? "00"}${suffix}`;
  };
  return ev.endTime ? `${time(ev.startTime)} – ${time(ev.endTime)}` : time(ev.startTime);
}

function formatDoseTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
}

function defaultFormState(): ScheduleConflictFormState {
  const today = formatDateLocal(new Date());
  return {
    mode: "at",
    date: today,
    time: "09:00",
    rangeStartDate: today,
    rangeStartTime: "09:00",
    rangeEndDate: today,
    rangeEndTime: "10:00",
    bufferBefore: "",
    bufferAfter: "",
    bufferOpen: false,
  };
}

function applyFormState(target: ScheduleConflictFormState, source: ScheduleConflictFormState): void {
  target.mode = source.mode;
  target.date = source.date;
  target.time = source.time;
  target.rangeStartDate = source.rangeStartDate;
  target.rangeStartTime = source.rangeStartTime;
  target.rangeEndDate = source.rangeEndDate;
  target.rangeEndTime = source.rangeEndTime;
  target.bufferBefore = source.bufferBefore;
  target.bufferAfter = source.bufferAfter;
  target.bufferOpen = source.bufferOpen;
}

export function ScheduleConflictChecker({
  healthModuleEnabled = false,
  embedded = false,
  initialForm,
  autoCheck = false,
  onCreateEvent,
  showCreateEventAction = true,
}: {
  healthModuleEnabled?: boolean;
  /** When true, renders without the dashboard Card wrapper. */
  embedded?: boolean;
  /** Pre-fill the checker (e.g. from the new-event sheet). */
  initialForm?: ScheduleConflictFormState | null;
  /** Run a check as soon as `initialForm` is applied. */
  autoCheck?: boolean;
  /** When set (calendar page), open the new-event sheet instead of navigating. */
  onCreateEvent?: (draft: CalendarCreateDraft) => void;
  showCreateEventAction?: boolean;
}) {
  const [form, setForm] = useState<ScheduleConflictFormState>(() => defaultFormState());

  const [result, setResult] = useState<ScheduleConflictResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChecked, setHasChecked] = useState(false);

  const lastAutoKeyRef = useRef<string | null>(null);

  const runCheck = useCallback(async (snapshot: ScheduleConflictFormState) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setHasChecked(false);
    try {
      const params = buildConflictCheckParams(snapshot);
      const data = await apiClient.get<ScheduleConflictResponse>(
        `/api/schedule-conflicts/check?${params.toString()}`,
      );
      setResult(data);
      setHasChecked(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to check schedule");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialForm) return;
    const key = JSON.stringify(initialForm);
    if (autoCheck && lastAutoKeyRef.current === key) return;
    lastAutoKeyRef.current = key;
    const next = { ...defaultFormState() };
    applyFormState(next, initialForm);
    setForm(next);
    if (autoCheck) void runCheck(next);
  }, [initialForm, autoCheck, runCheck]);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    await runCheck(form);
  }

  const createDraft = result ? createDraftFromCheckedWindow(result.checkedWindow) : null;
  const createHref =
    createDraft && !onCreateEvent
      ? `/calendar?${calendarCreateDraftToSearchParams(createDraft).toString()}`
      : null;

  const body = (
    <div className="space-y-5">
      {error && (
        <Alert variant="error" className="text-sm">
          {error}
        </Alert>
      )}

      <form className="space-y-4" onSubmit={check}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Check</span>
            <Select
              value={form.mode}
              onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as ScheduleConflictFormState["mode"] }))}
            >
              <option value="at">At a time</option>
              <option value="range">Time range</option>
            </Select>
          </label>

          {form.mode === "at" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Date</span>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  required
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Time</span>
                <Input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                  required
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Start</span>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="date"
                    value={form.rangeStartDate}
                    onChange={(e) => setForm((f) => ({ ...f, rangeStartDate: e.target.value }))}
                    required
                  />
                  <Input
                    type="time"
                    value={form.rangeStartTime}
                    onChange={(e) => setForm((f) => ({ ...f, rangeStartTime: e.target.value }))}
                    required
                  />
                </div>
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">End</span>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="date"
                    value={form.rangeEndDate}
                    onChange={(e) => setForm((f) => ({ ...f, rangeEndDate: e.target.value }))}
                    required
                  />
                  <Input
                    type="time"
                    value={form.rangeEndTime}
                    onChange={(e) => setForm((f) => ({ ...f, rangeEndTime: e.target.value }))}
                    required
                  />
                </div>
              </label>
            </div>
          )}
        </div>

        <details
          className="rounded-[var(--radius-md)] border border-[var(--color-border)]/80 bg-[var(--color-surface-subtle)]/40 px-3 py-2"
          open={form.bufferOpen}
          onToggle={(e) =>
            setForm((f) => ({ ...f, bufferOpen: (e.target as HTMLDetailsElement).open }))
          }
        >
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-muted)] marker:content-none hover:text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
            Drive buffer (this check only)
          </summary>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            Pads this check by a manually-entered travel time. When you create an event from these
            results, this buffer is copied onto the new event.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Minutes before</span>
              <Input
                type="number"
                min={0}
                max={1440}
                step={1}
                value={form.bufferBefore}
                onChange={(e) => setForm((f) => ({ ...f, bufferBefore: e.target.value }))}
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
                value={form.bufferAfter}
                onChange={(e) => setForm((f) => ({ ...f, bufferAfter: e.target.value }))}
                placeholder="0"
              />
            </label>
          </div>
        </details>

        <Button type="submit" loading={loading} size={embedded ? "sm" : "md"}>
          Check
        </Button>
      </form>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
      )}

      {!loading && hasChecked && result && (
        <div className="space-y-4 border-t border-[var(--color-border)]/60 pt-4">
          {showCreateEventAction && createDraft && (
            <div className="flex flex-wrap items-center gap-2">
              {onCreateEvent ? (
                <Button type="button" size="sm" onClick={() => onCreateEvent(createDraft)}>
                  Create event with this time
                </Button>
              ) : createHref ? (
                <AnchorButton href={createHref} size="sm">
                  Create event with this time
                </AnchorButton>
              ) : null}
            </div>
          )}

          {result.conflicts.red.length === 0 && result.conflicts.yellow.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">No conflicts in this window.</p>
          )}

          {result.conflicts.red.length > 0 && (
            <ul className="space-y-2">
              {result.conflicts.red.map(({ event }) => (
                <li key={event.id}>
                  <Link
                    href={`/calendar?event=${encodeURIComponent(event.id)}`}
                    className="flex items-center gap-3 rounded-[var(--radius-lg)] border px-3 py-2.5 text-sm"
                    style={{
                      borderColor: "var(--color-danger)",
                      background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
                    }}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: event.color ?? "var(--color-danger)" }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{event.title}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{formatEventWhen(event)} · overlaps</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {result.conflicts.yellow.length > 0 && (
            <ul className="space-y-2">
              {result.conflicts.yellow.map(({ event, reason }) => (
                <li key={event.id}>
                  <Link
                    href={`/calendar?event=${encodeURIComponent(event.id)}`}
                    className="flex items-center gap-3 rounded-[var(--radius-lg)] border px-3 py-2.5 text-sm"
                    style={{
                      borderColor: "var(--color-warning)",
                      background: "color-mix(in srgb, var(--color-warning) 12%, transparent)",
                    }}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: event.color ?? "var(--color-warning)" }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{event.title}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {formatEventWhen(event)} ·{" "}
                        {reason === "event_buffer_encroachment" ? "close — drive time" : "close — your buffer"}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {healthModuleEnabled && result.meds.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-label text-[var(--color-text-muted)]">Meds due in this window</h4>
              <ul className="space-y-2">
                {result.meds.map((med) => (
                  <li key={med.id}>
                    <Link
                      href={med.deepLink || "/health"}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3 py-2.5 text-sm hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-subtle)]"
                    >
                      <span className="truncate font-medium">{med.title}</span>
                      <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                        {formatDoseTime(med.scheduledAt, result.checkedWindow.timeZone)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <Card>
      <CardHeader>
        <SectionHeader title="Schedule conflict checker" />
      </CardHeader>
      <CardBody>{body}</CardBody>
    </Card>
  );
}
