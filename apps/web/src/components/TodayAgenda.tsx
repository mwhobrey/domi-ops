"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { CalendarEventView } from "../lib/calendar-utils";
import { isOverlayEvent } from "../lib/calendar-utils";
import { Alert, Card, CardBody, CardHeader, SectionHeader, Skeleton } from "./ui";

function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatEventTime(ev: CalendarEventView): string {
  if (ev.allDay) return "All day";
  if (!ev.startTime) return "Timed";
  const [hStr, mStr] = ev.startTime.split(":");
  const h = Number(hStr);
  const m = mStr ?? "00";
  if (Number.isNaN(h)) return ev.startTime;
  const suffix = h >= 12 ? "p" : "a";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m}${suffix}`;
}

const TIMED_PREVIEW = 4;
const ALL_DAY_PREVIEW = 2;

export function TodayAgenda() {
  const router = useRouter();
  const today = useMemo(() => todayIsoLocal(), []);
  const [events, setEvents] = useState<CalendarEventView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<{ events: CalendarEventView[] }>(
        `/api/calendar/events?from=${today}&to=${today}`,
      );
      const day = data.events.filter(
        (e) => e.startDate === today || (e.endDate && e.startDate <= today && e.endDate >= today),
      );
      setEvents(day);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load today’s schedule");
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    void load();
  }, [load]);

  const { preview, timedOverflow, allDayOverflow } = useMemo(() => {
    const timed = events
      .filter((e) => !e.allDay)
      .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    const allDay = events
      .filter((e) => e.allDay)
      .sort((a, b) => a.title.localeCompare(b.title));
    return {
      preview: [...timed.slice(0, TIMED_PREVIEW), ...allDay.slice(0, ALL_DAY_PREVIEW)],
      timedOverflow: Math.max(0, timed.length - TIMED_PREVIEW),
      allDayOverflow: Math.max(0, allDay.length - ALL_DAY_PREVIEW),
    };
  }, [events]);

  const moreCount = timedOverflow + allDayOverflow;

  return (
    <Card className="h-full">
      <CardHeader>
        <SectionHeader
          title="Today’s schedule"
          action={
            <Link
              href="/calendar"
              className="text-xs font-medium text-[var(--color-accent)] hover:underline"
            >
              Full calendar
            </Link>
          }
        />
      </CardHeader>
      <CardBody>
        {error && (
          <Alert variant="error" className="mb-3 text-sm">
            {error}{" "}
            <button type="button" className="underline" onClick={() => void load()}>
              Retry
            </button>
          </Alert>
        )}
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        ) : preview.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Nothing on the calendar today.</p>
        ) : (
          <ul className="space-y-2">
            {preview.map((ev) => (
              <li key={ev.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3 py-2.5 text-left transition hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
                  onClick={() => {
                    if (isOverlayEvent(ev) && ev.deepLink) {
                      router.push(ev.deepLink);
                      return;
                    }
                    router.push(`/calendar?event=${encodeURIComponent(ev.id)}`);
                  }}
                >
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: ev.color ?? "var(--color-accent)" }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{ev.title}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{formatEventTime(ev)}</p>
                  </div>
                </button>
              </li>
            ))}
            {moreCount > 0 ? (
              <li>
                <Link
                  href="/calendar"
                  className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                >
                  +{moreCount} more on calendar
                  {allDayOverflow > 0 && timedOverflow === 0
                    ? ` (${allDayOverflow} all-day)`
                    : ""}
                </Link>
              </li>
            ) : null}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
