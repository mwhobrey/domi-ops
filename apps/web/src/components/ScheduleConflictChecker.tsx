"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, apiClient } from "../lib/client-api";
import { formatDateLocal } from "../lib/calendar-utils";
import { Alert, Button, Card, CardBody, CardHeader, Input, SectionHeader, Select, Skeleton } from "./ui";

type ScheduleConflictMode = "at" | "range";

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
  checkedWindow: {
    mode: ScheduleConflictMode;
    timeZone: string;
    startAt: string;
    endAt: string;
    adHocBuffer: { beforeMinutes: number; afterMinutes: number } | null;
  };
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

export function ScheduleConflictChecker({ healthModuleEnabled = false }: { healthModuleEnabled?: boolean }) {
  const today = formatDateLocal(new Date());

  const [mode, setMode] = useState<ScheduleConflictMode>("at");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("09:00");
  const [rangeStartDate, setRangeStartDate] = useState(today);
  const [rangeStartTime, setRangeStartTime] = useState("09:00");
  const [rangeEndDate, setRangeEndDate] = useState(today);
  const [rangeEndTime, setRangeEndTime] = useState("10:00");
  const [bufferOpen, setBufferOpen] = useState(false);
  const [bufferBefore, setBufferBefore] = useState("");
  const [bufferAfter, setBufferAfter] = useState("");

  const [result, setResult] = useState<ScheduleConflictResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChecked, setHasChecked] = useState(false);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setHasChecked(false);
    try {
      const params = new URLSearchParams({ mode });
      if (mode === "at") {
        params.set("date", date);
        params.set("time", time);
      } else {
        params.set("startDate", rangeStartDate);
        params.set("startTime", rangeStartTime);
        params.set("endDate", rangeEndDate);
        params.set("endTime", rangeEndTime);
      }
      if (bufferOpen && bufferBefore) params.set("bufferBeforeMinutes", bufferBefore);
      if (bufferOpen && bufferAfter) params.set("bufferAfterMinutes", bufferAfter);

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
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader title="Schedule conflict checker" />
      </CardHeader>
      <CardBody className="space-y-5">
        {error && (
          <Alert variant="error" className="text-sm">
            {error}
          </Alert>
        )}

        <form className="space-y-4" onSubmit={check}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Check</span>
              <Select value={mode} onChange={(e) => setMode(e.target.value as ScheduleConflictMode)}>
                <option value="at">At a time</option>
                <option value="range">Time range</option>
              </Select>
            </label>

            {mode === "at" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">Date</span>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">Time</span>
                  <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">Start</span>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="date"
                      value={rangeStartDate}
                      onChange={(e) => setRangeStartDate(e.target.value)}
                      required
                    />
                    <Input
                      type="time"
                      value={rangeStartTime}
                      onChange={(e) => setRangeStartTime(e.target.value)}
                      required
                    />
                  </div>
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">End</span>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="date"
                      value={rangeEndDate}
                      onChange={(e) => setRangeEndDate(e.target.value)}
                      required
                    />
                    <Input
                      type="time"
                      value={rangeEndTime}
                      onChange={(e) => setRangeEndTime(e.target.value)}
                      required
                    />
                  </div>
                </label>
              </div>
            )}
          </div>

          <details
            className="rounded-[var(--radius-md)] border border-[var(--color-border)]/80 bg-[var(--color-surface-subtle)]/40 px-3 py-2"
            onToggle={(e) => setBufferOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-muted)] marker:content-none hover:text-[var(--color-text)] [&::-webkit-details-marker]:hidden">
              Drive buffer (this check only)
            </summary>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Pads this check by a manually-entered travel time. Not saved to any event.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Minutes before</span>
                <Input type="number" min={0} max={1440} step={1} value={bufferBefore} onChange={(e) => setBufferBefore(e.target.value)} placeholder="0" />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Minutes after</span>
                <Input type="number" min={0} max={1440} step={1} value={bufferAfter} onChange={(e) => setBufferAfter(e.target.value)} placeholder="0" />
              </label>
            </div>
          </details>

          <Button type="submit" loading={loading}>
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
      </CardBody>
    </Card>
  );
}
