"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { CalendarEventView } from "../lib/calendar-utils";
import { addDays, formatDateISO, startOfWeek, weekRange } from "../lib/calendar-utils";
import { CalendarAgendaView } from "./CalendarAgendaView";
import { CalendarConnectCard } from "./CalendarConnectCard";
import { CalendarEventSheet } from "./CalendarEventSheet";
import { CalendarWeek } from "./CalendarWeek";
import { Alert, Button, Input } from "./ui";

type ViewMode = "week" | "agenda";

export function CalendarPageClient({
  oauthConfigured,
  defaultSyncMode,
  initialConnections,
  connectedBanner,
  errorBanner,
}: {
  oauthConfigured: boolean;
  defaultSyncMode: string;
  initialConnections: { id: string; lastSyncAt: string | null }[];
  connectedBanner?: boolean;
  errorBanner?: string;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [events, setEvents] = useState<CalendarEventView[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("week");
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<CalendarEventView | null>(null);
  const [agendaFilter, setAgendaFilter] = useState<CalendarEventView[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const range = useMemo(() => {
    if (debouncedQ) {
      const from = formatDateISO(addDays(new Date(), -30));
      const to = formatDateISO(addDays(new Date(), 365));
      return { from, to };
    }
    return weekRange(weekStart);
  }, [weekStart, debouncedQ]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (debouncedQ) params.set("q", debouncedQ);
      const data = await apiClient.get<{ events: CalendarEventView[] }>(
        `/api/calendar/events?${params}`,
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
        })),
      );
    } catch (err) {
      setFetchError(err instanceof ApiError ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, debouncedQ]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const displayEvents = agendaFilter ?? events;

  return (
    <div>
      {connectedBanner && (
        <Alert variant="success" className="mb-4">
          Google Calendar connected. Initial import queued.
        </Alert>
      )}
      {errorBanner && (
        <Alert variant="error" className="mb-4">
          Calendar connection failed ({errorBanner}).
        </Alert>
      )}
      {fetchError && (
        <Alert variant="error" className="mb-4">
          {fetchError}{" "}
          <button type="button" className="underline" onClick={loadEvents}>
            Retry
          </button>
        </Alert>
      )}

      <CalendarConnectCard
        oauthConfigured={oauthConfigured}
        defaultSyncMode={defaultSyncMode}
        connections={initialConnections}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Search events…"
          value={search}
          onChange={(e) => {
            const q = e.target.value;
            setSearch(q);
            setAgendaFilter(null);
            if (q.trim()) setView("agenda");
            else setView("week");
          }}
        />
        <div className="flex rounded-[var(--radius-lg)] border border-[var(--color-border)] p-0.5">
          <Button
            size="sm"
            variant={view === "week" ? "primary" : "ghost"}
            onClick={() => {
              setView("week");
              setAgendaFilter(null);
            }}
          >
            Week
          </Button>
          <Button
            size="sm"
            variant={view === "agenda" ? "primary" : "ghost"}
            onClick={() => setView("agenda")}
          >
            Agenda
          </Button>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setSelected(null);
            setSheetOpen(true);
          }}
        >
          New event
        </Button>
      </div>

      {view === "week" ? (
        <CalendarWeek
          events={displayEvents}
          weekStart={weekStart}
          loading={loading}
          onWeekChange={(s) => {
            setWeekStart(s);
            setAgendaFilter(null);
          }}
          onEventClick={(ev) => {
            setSelected(ev);
            setSheetOpen(true);
          }}
          onMoreClick={(date, dayEvents) => {
            setView("agenda");
            setAgendaFilter(dayEvents);
          }}
        />
      ) : (
        <CalendarAgendaView
          events={displayEvents}
          loading={loading}
          onEventClick={(ev) => {
            setSelected(ev);
            setSheetOpen(true);
          }}
        />
      )}

      <CalendarEventSheet
        open={sheetOpen}
        selected={selected}
        onClose={() => {
          setSheetOpen(false);
          setSelected(null);
        }}
        onSaved={(ev, isNew) => {
          setEvents((prev) => (isNew ? [...prev, ev] : prev.map((x) => (x.id === ev.id ? ev : x))));
        }}
        onDeleted={(id) => setEvents((prev) => prev.filter((e) => e.id !== id))}
      />
    </div>
  );
}
