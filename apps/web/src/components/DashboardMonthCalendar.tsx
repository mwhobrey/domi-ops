"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { ApiError, apiClient } from "../lib/client-api";
import type { CalendarEventView } from "../lib/calendar-utils";
import { addMonths, isOverlayEvent, monthRange, startOfMonth } from "../lib/calendar-utils";
import { tempUnitSuffix } from "../lib/home-status";
import { dayWeatherSummary, matchSlotForEvent } from "../lib/weather-hourly-match";
import { useWeatherForecast } from "../lib/use-weather-forecast";
import { weatherIcon, weatherLabel } from "../lib/weather-codes";
import { CalendarMonthView } from "./calendar/CalendarMonthView";
import { Alert, Button, Card, CardBody, CardHeader, SectionHeader, Sheet, Skeleton } from "./ui";

export function DashboardMonthCalendar({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [events, setEvents] = useState<CalendarEventView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const monthLabel = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { from, to } = monthRange(monthStart);
    try {
      const data = await apiClient.get<{ events: CalendarEventView[] }>(
        `/api/calendar/events?from=${from}&to=${to}`,
      );
      setEvents(
        data.events.map((e) => ({
          id: e.id,
          title: e.title,
          startDate: e.startDate,
          startTime: e.startTime,
          endTime: e.endTime,
          allDay: e.allDay,
          color: e.color,
          calendarId: e.calendarId,
          deepLink: e.deepLink,
          source: e.source,
          overlayKind: e.overlayKind,
        })),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [monthStart]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const dayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return events
      .filter((e) => e.startDate === selectedDate)
      .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  }, [events, selectedDate]);

  const selectedLabel = selectedDate
    ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "";

  const dayForecast = useWeatherForecast(selectedDate, sheetOpen && Boolean(selectedDate));
  const daySummary = dayWeatherSummary(dayForecast.dayHourly);
  const hasTimedEvents = dayEvents.some((e) => !e.allDay && e.startTime);
  const showDayWeather = Boolean(dayForecast.location) && !dayForecast.needsLocation;

  return (
    <>
      <Card className={compact ? "h-full" : undefined}>
        <CardHeader className={compact ? "pb-2" : undefined}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionHeader
              title={compact ? "Month" : "Household calendar"}
              action={
                compact ? (
                  <Link
                    href="/calendar"
                    className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                  >
                    Open calendar
                  </Link>
                ) : undefined
              }
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMonthStart((m) => addMonths(m, -1))}
              >
                Prev
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setMonthStart(startOfMonth(new Date()))}>
                Today
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMonthStart((m) => addMonths(m, 1))}
              >
                Next
              </Button>
              <span
                className={cn(
                  "font-medium text-[var(--color-text-muted)]",
                  compact ? "text-xs" : "text-sm",
                )}
              >
                {monthLabel}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {error && (
            <Alert variant="error" className="mb-4">
              {error}{" "}
              <button type="button" className="underline" onClick={loadEvents}>
                Retry
              </button>
            </Alert>
          )}
          {loading ? (
            <Skeleton className={cn("w-full", compact ? "h-44" : "h-64")} />
          ) : (
            <>
              <CalendarMonthView
                monthStart={monthStart}
                events={events}
                compact={compact}
                onDaySelect={(date) => {
                  setSelectedDate(date);
                  setSheetOpen(true);
                }}
              />
              {!compact && (
                <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                  Tap a day to see what&apos;s scheduled.
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Sheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setSelectedDate(null);
        }}
        title={selectedLabel || "Day schedule"}
      >
        <div className="space-y-4 p-5">
          {showDayWeather && daySummary && dayEvents.some((e) => e.allDay) && (
            <p className="text-xs text-[var(--color-text-muted)]">
              <span className="sr-only">{weatherLabel(daySummary.weatherCode)}</span>
              <span aria-hidden>{weatherIcon(daySummary.weatherCode)}</span> Day:{" "}
              {Math.round(daySummary.tempMin)}
              {tempUnitSuffix(dayForecast.temperatureUnit)}–{Math.round(daySummary.tempMax)}
              {tempUnitSuffix(dayForecast.temperatureUnit)}
            </p>
          )}
          {dayEvents.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Nothing scheduled this day.</p>
          ) : (
            <ul className="space-y-2">
              {dayEvents.map((ev) => {
                const slot =
                  showDayWeather && !ev.allDay
                    ? matchSlotForEvent(ev.startTime, dayForecast.dayHourly)
                    : null;
                return (
                  <li key={ev.id}>
                    <button
                      type="button"
                      className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-3 text-left"
                      onClick={() => {
                        if (isOverlayEvent(ev) && ev.deepLink) {
                          router.push(ev.deepLink);
                          return;
                        }
                        router.push(`/calendar?event=${encodeURIComponent(ev.id)}`);
                      }}
                    >
                      <div className="flex items-start gap-3">
                      <span
                        className="mt-1 h-3 w-3 shrink-0 rounded-full"
                        style={{ background: ev.color ?? "var(--color-accent)" }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{ev.title}</p>
                        <p className="text-sm text-[var(--color-text-muted)]">
                          {ev.allDay ? "All day" : (ev.startTime ?? "Timed")}
                        </p>
                      </div>
                      {showDayWeather && !ev.allDay && (
                        <div className="shrink-0 text-right text-sm tabular-nums">
                          {dayForecast.loading ? (
                            <Skeleton className="ml-auto h-8 w-12" />
                          ) : slot ? (
                            <>
                              <span className="sr-only">{weatherLabel(slot.weatherCode)}</span>
                              <span className="text-base" aria-hidden>
                                {weatherIcon(slot.weatherCode)}
                              </span>
                              <p className="font-medium">
                                {Math.round(slot.temperature)}
                                {tempUnitSuffix(dayForecast.temperatureUnit)}
                              </p>
                            </>
                          ) : null}
                        </div>
                      )}
                    </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {showDayWeather && hasTimedEvents && dayForecast.loading && (
            <p className="text-xs text-[var(--color-text-muted)]">Loading forecast…</p>
          )}
          <Link
            href="/calendar"
            className="inline-flex text-sm font-medium text-[var(--color-accent)] hover:underline"
            onClick={() => {
              setSheetOpen(false);
              setSelectedDate(null);
            }}
          >
            Open full calendar →
          </Link>
        </div>
      </Sheet>
    </>
  );
}
