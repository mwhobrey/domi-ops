"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type {
  CalendarCreateDraft,
  CalendarEventView,
  CalendarViewMode,
} from "../lib/calendar-utils";
import type { ReschedulePatch } from "../lib/calendar-time-grid";
import {
  addDays,
  addMonths,
  agendaRange,
  CALENDAR_VIEW_STORAGE_KEY,
  formatDateLocal,
  monthRange,
  parseLocalDate,
  readStoredCalendarView,
  searchRange,
  startOfMonth,
  startOfWeek,
  weekRange,
} from "../lib/calendar-utils";
import { useIsDesktop } from "../lib/use-media-query";
import { useMeasuredCssVar } from "../lib/use-measured-css-var";
import { CalendarAgendaView } from "./CalendarAgendaView";
import { CalendarEventSheet } from "./CalendarEventSheet";
import { CalendarFilterBar } from "./calendar/CalendarFilterBar";
import {
  CalendarGoogleSheet,
  type CalendarConnectionSummary,
} from "./calendar/CalendarGoogleSheet";
import { CalendarImportWizard } from "./calendar/CalendarImportWizard";
import { CalendarSetupBanner } from "./calendar/CalendarSetupBanner";
import { eventOverlapsDate } from "../lib/calendar-event-span";
import { categoryCompositeKey } from "../lib/calendar-event-colors";
import {
  categoriesFromEvents,
  filterEventsByCategories,
  filterEventsByLanes,
  filterEventsByOverlays,
  filterLaneGroupsWithEvents,
  groupLanesByName,
  overlayKindsFromEvents,
  readDefaultCalendarId,
  readHiddenCategoryKeys,
  readHiddenOverlayKinds,
  sortLaneGroupsForDisplay,
  readHiddenLaneIds,
  toggleHiddenCategory,
  toggleHiddenOverlay,
  toggleLaneGroup,
  writeDefaultCalendarId,
  type CalendarLaneMeta,
  type EventCategoryMeta,
  type OverlayFilterMeta,
} from "../lib/calendar-filters";
import { isOverlayEvent } from "../lib/calendar-utils";
import {
  RecurringScopeSheet,
  type RecurringScope,
} from "./calendar/RecurringScopeSheet";
import { CalendarSyncProgress } from "./calendar/CalendarSyncProgress";
import { useCalendarSyncStatus } from "../lib/use-calendar-sync-status";
import { formatWeekPeriodLabel } from "./CalendarWeek";
import { CalendarDaySheet } from "./calendar/CalendarDaySheet";
import { CalendarDayView, formatDayPeriodLabel } from "./calendar/CalendarDayView";
import { CalendarMonthView } from "./calendar/CalendarMonthView";
import { CalendarToolbar } from "./calendar/CalendarToolbar";
import { CalendarWeek } from "./CalendarWeek";
import { Calendar } from "lucide-react";
import { cn } from "../lib/cn";
import { Alert, Button, IconButton, Input } from "./ui";

function mapLoadedEvent(e: CalendarEventView): CalendarEventView {
  return {
    id: e.id,
    title: e.title,
    description: e.description ?? null,
    startDate: e.startDate,
    endDate: e.endDate ?? null,
    startTime: e.startTime,
    endTime: e.endTime,
    allDay: e.allDay,
    color: e.color,
    categoryKey: e.categoryKey ?? null,
    categoryLabel: e.categoryLabel ?? null,
    timeZone: e.timeZone ?? null,
    calendarId: e.calendarId,
    source: e.source,
    googleEventId: e.googleEventId ?? null,
    editable: e.editable,
    pushable: e.pushable,
    syncStatus: e.syncStatus,
    recurringRuleId: e.recurringRuleId ?? null,
    reminderOffsets: e.reminderOffsets ?? [],
    overlayKind: e.overlayKind,
    deepLink: e.deepLink,
  };
}

export function CalendarPageClient({
  oauthConfigured,
  defaultSyncMode,
  initialConnections,
  openImportWizard,
  errorBanner,
  oauthFailureMessage,
  publicAppUrl,
}: {
  oauthConfigured: boolean;
  defaultSyncMode: string;
  initialConnections: CalendarConnectionSummary[];
  openImportWizard?: boolean;
  errorBanner?: string;
  oauthFailureMessage?: string;
  publicAppUrl?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isDesktop = useIsDesktop();
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>("agenda");
  const [viewReady, setViewReady] = useState(false);
  const [events, setEvents] = useState<CalendarEventView[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<CalendarEventView | null>(null);
  const [daySheetDate, setDaySheetDate] = useState<string | null>(null);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CalendarCreateDraft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lanes, setLanes] = useState<CalendarLaneMeta[]>([]);
  const [hiddenLaneIds, setHiddenLaneIds] = useState<Set<string>>(() => readHiddenLaneIds());
  const [hiddenCategoryKeys, setHiddenCategoryKeys] = useState<Set<string>>(() =>
    readHiddenCategoryKeys(),
  );
  const [hiddenOverlayKinds, setHiddenOverlayKinds] = useState<Set<string>>(() =>
    readHiddenOverlayKinds(),
  );
  const [presetCategories, setPresetCategories] = useState<EventCategoryMeta[]>([]);
  const [defaultCalendarId, setDefaultCalendarId] = useState<string | null>(() =>
    readDefaultCalendarId(),
  );
  const [recurringPending, setRecurringPending] = useState<{
    event: CalendarEventView;
    patch: ReschedulePatch;
  } | null>(null);
  const [googleSheetOpen, setGoogleSheetOpen] = useState(false);
  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const [needsImportSetup, setNeedsImportSetup] = useState(false);
  const autoOpenedImportRef = useRef(false);
  const openedEventDeepLinkRef = useRef<string | null>(null);
  const connected = initialConnections.length > 0;
  const { status: syncStatus, refresh: refreshSyncStatus, isActive: syncActive } =
    useCalendarSyncStatus(connected);
  const syncWasActive = useRef(false);
  const stickyChromeRef = useRef<HTMLDivElement>(null);

  useMeasuredCssVar(stickyChromeRef, "--calendar-chrome-height", { fallback: "10rem" });

  const agendaDayHeaderStickyTop =
    "calc(var(--header-height) + var(--calendar-chrome-height))";

  const clearEventDeepLink = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (!next.has("event")) return;
    next.delete("event");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!openImportWizard || autoOpenedImportRef.current) return;
    autoOpenedImportRef.current = true;
    setImportWizardOpen(true);
  }, [openImportWizard]);

  const clearImportDeepLink = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (!next.has("import") && !next.has("connected")) return;
    next.delete("import");
    next.delete("connected");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    setViewMode(isDesktop ? readStoredCalendarView() : "agenda");
    setViewReady(true);
  }, [isDesktop]);

  useEffect(() => {
    const eventId = searchParams.get("event");
    if (!eventId || openedEventDeepLinkRef.current === eventId) return;

    const openFromDeepLink = async () => {
      const inList = events.find((e) => e.id === eventId);
      if (inList) {
        openedEventDeepLinkRef.current = eventId;
        setSelected(inList);
        setSheetOpen(true);
        setActionError(null);
        clearEventDeepLink();
        return;
      }

      try {
        const data = await apiClient.get<{ event: CalendarEventView }>(
          `/api/calendar/events/${eventId}`,
        );
        const mapped = mapLoadedEvent(data.event);
        openedEventDeepLinkRef.current = eventId;
        setFocusDate(parseLocalDate(mapped.startDate));
        setSelected(mapped);
        setSheetOpen(true);
        setActionError(null);
        clearEventDeepLink();
      } catch {
        setActionError("This event was deleted or you do not have access.");
        clearEventDeepLink();
      }
    };

    void openFromDeepLink();
  }, [searchParams, events, clearEventDeepLink]);

  const persistView = useCallback(
    (v: CalendarViewMode) => {
      setViewMode(v);
      if (isDesktop) sessionStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, v);
    },
    [isDesktop],
  );

  const effectiveView: CalendarViewMode = debouncedQ
    ? "agenda"
    : isDesktop
      ? viewMode
      : viewMode === "month"
        ? "month"
        : "agenda";

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const monthStart = useMemo(() => startOfMonth(focusDate), [focusDate]);
  const weekStart = useMemo(() => startOfWeek(focusDate), [focusDate]);

  const range = useMemo(() => {
    if (debouncedQ) return searchRange();
    switch (effectiveView) {
      case "month":
        return monthRange(monthStart);
      case "week":
        return weekRange(weekStart);
      case "day":
        return { from: formatDateLocal(focusDate), to: formatDateLocal(focusDate) };
      case "agenda":
      default:
        return agendaRange(focusDate);
    }
  }, [debouncedQ, effectiveView, monthStart, weekStart, focusDate]);

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
        data.events.map((e) => mapLoadedEvent(e)),
      );
    } catch (err) {
      setFetchError(err instanceof ApiError ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, debouncedQ]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await apiClient.get<{
        categories: {
          id: string;
          calendarId: string;
          key: string;
          label: string;
          color: string | null;
        }[];
      }>("/api/calendar/event-categories");
      const laneNames = new Map(lanes.map((l) => [l.id, l.name]));
      setPresetCategories(
        res.categories.map((c) => ({
          id: categoryCompositeKey(c.calendarId, c.key),
          calendarId: c.calendarId,
          key: c.key,
          label: laneNames.get(c.calendarId)
            ? `${laneNames.get(c.calendarId)} · ${c.label}`
            : c.label,
          color: c.color,
        })),
      );
    } catch {
      /* ignore */
    }
  }, [lanes]);

  const loadLanes = useCallback(async () => {
    try {
      const res = await apiClient.get<{
        calendars: { id: string; name: string; color: string | null; isHouseholdDefault: boolean }[];
      }>("/api/calendar/calendars");
      const meta = res.calendars.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
      }));
      setLanes(meta);
      const householdDefault = res.calendars.find((c) => c.isHouseholdDefault);
      if (!readDefaultCalendarId() && householdDefault) {
        setDefaultCalendarId(householdDefault.id);
        writeDefaultCalendarId(householdDefault.id);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadLanes();
  }, [loadLanes]);

  const refreshImportSetup = useCallback(async () => {
    if (!connected || !oauthConfigured) {
      setNeedsImportSetup(false);
      return;
    }
    try {
      const data = await apiClient.get<{
        linkedCalendars: { syncEnabled: boolean }[];
      }>("/api/calendar/import/options");
      const anyEnabled = data.linkedCalendars.some((c) => c.syncEnabled);
      setNeedsImportSetup(data.linkedCalendars.length > 0 && !anyEnabled);
    } catch {
      setNeedsImportSetup(false);
    }
  }, [connected, oauthConfigured]);

  useEffect(() => {
    void refreshImportSetup();
  }, [refreshImportSetup, importWizardOpen]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (syncActive) syncWasActive.current = true;
    if (
      syncWasActive.current &&
      !syncActive &&
      syncStatus?.run?.status === "idle"
    ) {
      syncWasActive.current = false;
      void loadEvents();
    }
  }, [syncActive, syncStatus?.run?.status, loadEvents]);

  const periodLabel = useMemo(() => {
    switch (effectiveView) {
      case "month":
        return monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      case "week":
        return formatWeekPeriodLabel(weekStart);
      case "day":
        return formatDayPeriodLabel(focusDate);
      default:
        return formatWeekPeriodLabel(weekStart);
    }
  }, [effectiveView, monthStart, weekStart, focusDate]);

  const handlePrev = useCallback(() => {
    switch (effectiveView) {
      case "month":
        setFocusDate((d) => addMonths(startOfMonth(d), -1));
        break;
      case "week":
        setFocusDate((d) => addDays(startOfWeek(d), -7));
        break;
      case "day":
        setFocusDate((d) => addDays(d, -1));
        break;
      default:
        setFocusDate((d) => addDays(startOfWeek(d), -7));
    }
  }, [effectiveView]);

  const handleNext = useCallback(() => {
    switch (effectiveView) {
      case "month":
        setFocusDate((d) => addMonths(startOfMonth(d), 1));
        break;
      case "week":
        setFocusDate((d) => addDays(startOfWeek(d), 7));
        break;
      case "day":
        setFocusDate((d) => addDays(d, 1));
        break;
      default:
        setFocusDate((d) => addDays(startOfWeek(d), 7));
    }
  }, [effectiveView]);

  const handleToday = useCallback(() => {
    setFocusDate(new Date());
  }, []);

  const allLaneGroups = useMemo(
    () => sortLaneGroupsForDisplay(groupLanesByName(lanes)),
    [lanes],
  );
  const filterLaneGroups = useMemo(
    () => filterLaneGroupsWithEvents(allLaneGroups, events),
    [allLaneGroups, events],
  );

  const categoryColorByKey = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const c of presetCategories) map.set(c.id, c.color);
    return map;
  }, [presetCategories]);

  const categoryFilterGroups = useMemo(() => {
    const fromEvents = categoriesFromEvents(events);
    const map = new Map<string, EventCategoryMeta>();
    for (const c of presetCategories) map.set(c.id, c);
    for (const c of fromEvents) {
      if (!map.has(c.id)) map.set(c.id, c);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [presetCategories, events]);

  const laneFilteredEvents = useMemo(
    () => filterEventsByLanes(events, hiddenLaneIds),
    [events, hiddenLaneIds],
  );

  const categoryFilteredEvents = useMemo(
    () => filterEventsByCategories(laneFilteredEvents, hiddenCategoryKeys),
    [laneFilteredEvents, hiddenCategoryKeys],
  );

  const visibleEvents = useMemo(
    () => filterEventsByOverlays(categoryFilteredEvents, hiddenOverlayKinds),
    [categoryFilteredEvents, hiddenOverlayKinds],
  );

  const overlayFilterGroups = useMemo(
    () => overlayKindsFromEvents(events),
    [events],
  );

  const openEventFromGrid = useCallback(
    (ev: CalendarEventView) => {
      if (isOverlayEvent(ev) && ev.deepLink) {
        router.push(ev.deepLink);
        return;
      }
      setSelected(ev);
      setCreateDraft(null);
      setSheetOpen(true);
    },
    [router],
  );

  const dayAgendaEvents = useMemo(() => {
    if (effectiveView !== "day" || isDesktop) return visibleEvents;
    const key = formatDateLocal(focusDate);
    return visibleEvents.filter((e) => eventOverlapsDate(e, key));
  }, [effectiveView, isDesktop, visibleEvents, focusDate]);

  const gridInteraction =
    isDesktop && !debouncedQ && (effectiveView === "week" || effectiveView === "day");

  const openCreateDraft = useCallback((date: string, hour: number) => {
    setSelected(null);
    setCreateDraft({
      startDate: date,
      startTime: `${String(hour).padStart(2, "0")}:00`,
      allDay: false,
    });
    setSheetOpen(true);
  }, []);

  const applyReschedule = useCallback(
    async (event: CalendarEventView, patch: ReschedulePatch, recurringScope?: RecurringScope) => {
      const previous = events;
      const optimistic: CalendarEventView = {
        ...event,
        startDate: patch.startDate,
        startTime: patch.startTime ?? null,
        endTime: patch.endTime ?? null,
        recurringRuleId:
          recurringScope === "this" ? null : event.recurringRuleId,
      };
      setEvents((prev) => prev.map((e) => (e.id === event.id ? optimistic : e)));
      setActionError(null);
      const qs = recurringScope ? `?recurringScope=${recurringScope}` : "";
      try {
        const body: Record<string, unknown> = {
          startDate: patch.startDate,
        };
        if (patch.startTime !== undefined) body.startTime = patch.startTime;
        if (patch.endTime !== undefined) body.endTime = patch.endTime;
        if (patch.startTime == null && patch.endTime == null) body.allDay = true;

        const data = await apiClient.patch<{ event: CalendarEventView }>(
          `/api/calendar/events/${event.id}${qs}`,
          body,
        );
        setEvents((prev) =>
          prev.map((e) =>
            e.id === event.id
              ? {
                  ...optimistic,
                  ...data.event,
                  startDate: data.event.startDate ?? patch.startDate,
                  startTime: data.event.startTime ?? patch.startTime ?? null,
                  endTime: data.event.endTime ?? patch.endTime ?? null,
                  editable: data.event.editable ?? e.editable,
                  pushable: data.event.pushable ?? e.pushable,
                  syncStatus: data.event.syncStatus ?? e.syncStatus,
                  recurringRuleId: data.event.recurringRuleId ?? optimistic.recurringRuleId,
                }
              : e,
          ),
        );
      } catch (err) {
        setEvents(previous);
        let msg = "Could not move event";
        if (err instanceof ApiError) {
          try {
            const parsed = err.body ? (JSON.parse(err.body) as { message?: string }) : null;
            if (parsed?.message) msg = parsed.message;
            else if (err.status === 403) msg = "This event cannot be edited.";
          } catch {
            if (err.status === 403) msg = "This event cannot be edited.";
          }
        }
        setActionError(msg);
      }
    },
    [events],
  );

  const requestReschedule = useCallback(
    (event: CalendarEventView, patch: ReschedulePatch) => {
      if (event.recurringRuleId) {
        setRecurringPending({ event, patch });
        return;
      }
      void applyReschedule(event, patch);
    },
    [applyReschedule],
  );

  if (!viewReady) return null;

  const showFilterBar = allLaneGroups.length > 0 && !debouncedQ;
  const gridFillsViewport =
    isDesktop && !debouncedQ && (effectiveView === "week" || effectiveView === "day");

  return (
    <div className="flex min-h-[calc(100dvh-var(--header-height)-10rem)] flex-col">
      {errorBanner && (
        <Alert variant="error" className="mb-4">
          <p>Calendar connection failed ({errorBanner}).</p>
          {oauthFailureMessage && (
            <p className="mt-2 text-sm font-normal opacity-90">{oauthFailureMessage}</p>
          )}
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
      {actionError && (
        <Alert variant="error" className="mb-4">
          {actionError}
          <button type="button" className="ml-2 underline" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </Alert>
      )}

      <CalendarSetupBanner
        oauthConfigured={oauthConfigured}
        connected={connected}
        needsImport={needsImportSetup}
        hasCalendars={lanes.length > 0}
        onImport={() => setImportWizardOpen(true)}
      />

      {(syncActive || syncStatus?.run?.status === "failed") && (
        <div className="mb-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-muted)]/30 p-4">
          <CalendarSyncProgress status={syncStatus} />
        </div>
      )}

      <div
        ref={stickyChromeRef}
        className="sticky top-[var(--header-height)] z-30 -mx-4 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-inset)]/95 px-4 py-2 backdrop-blur-sm"
        role="region"
        aria-label="Calendar controls"
      >
        <div className="flex flex-wrap items-center gap-2">
          {showFilterBar ? (
            <CalendarFilterBar
              laneGroups={filterLaneGroups}
              writeLaneGroups={allLaneGroups}
              hiddenIds={hiddenLaneIds}
              categoryGroups={categoryFilterGroups}
              hiddenCategoryKeys={hiddenCategoryKeys}
              overlayGroups={overlayFilterGroups}
              hiddenOverlayKinds={hiddenOverlayKinds}
              defaultCalendarId={defaultCalendarId}
              onToggleLaneGroup={(group) =>
                setHiddenLaneIds(toggleLaneGroup(group, hiddenLaneIds))
              }
              onToggleCategory={(key) => setHiddenCategoryKeys(toggleHiddenCategory(key))}
              onToggleOverlay={(kind) =>
                setHiddenOverlayKinds(toggleHiddenOverlay(kind))
              }
              onDefaultCalendarChange={(id) => {
                setDefaultCalendarId(id);
                writeDefaultCalendarId(id);
              }}
              onShowAllFilters={() => {
                setHiddenLaneIds(new Set());
                setHiddenCategoryKeys(new Set());
                setHiddenOverlayKinds(new Set());
              }}
            />
          ) : null}
          <Input
            className="min-w-[10rem] flex-1 sm:max-w-xs"
            placeholder="Search events…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search events"
          />
          <Button
            size="sm"
            className="shrink-0"
            data-tour="new-event-button"
            onClick={() => {
              setSelected(null);
              setCreateDraft(null);
              setSheetOpen(true);
            }}
          >
            New event
          </Button>
        </div>

        {!debouncedQ && (
          <CalendarToolbar
            className="mt-2"
            viewMode={!isDesktop && viewMode !== "month" ? "agenda" : viewMode}
            onViewChange={(v) => {
              persistView(v);
              if (v === "month") setFocusDate((d) => startOfMonth(d));
              if (v === "week") setFocusDate((d) => startOfWeek(d));
            }}
            periodLabel={periodLabel}
            onPrev={handlePrev}
            onToday={handleToday}
            onNext={handleNext}
            showWeekDay={isDesktop}
            loading={loading}
            trailing={
              <IconButton
                label={
                  syncActive
                    ? "Calendar sync in progress — open settings"
                    : "Calendar settings"
                }
                onClick={() => setGoogleSheetOpen(true)}
              >
                <Calendar
                  className={`h-5 w-5 ${
                    syncActive || connected ? "text-[var(--color-accent)]" : ""
                  }`}
                />
              </IconButton>
            }
          />
        )}
      </div>

      <div className={cn("min-h-0 flex-1", gridFillsViewport && "flex flex-col")}>
      {!isDesktop && effectiveView !== "month" && (
        <p className="sr-only">Week and day grid views are available on larger screens.</p>
      )}

      {effectiveView === "month" && (
        <CalendarMonthView
          monthStart={monthStart}
          events={visibleEvents}
          compact={!isDesktop}
          onDaySelect={(date) => {
            setDaySheetDate(date);
            setDaySheetOpen(true);
          }}
        />
      )}

      {effectiveView === "week" && isDesktop && (
        <CalendarWeek
          events={visibleEvents}
          weekStart={weekStart}
          loading={loading}
          categoryColorByKey={categoryColorByKey}
          interactionEnabled={gridInteraction && !loading}
          fillViewport
          className={gridFillsViewport ? "min-h-0 flex-1" : undefined}
          onSlotClick={openCreateDraft}
          onEventReschedule={requestReschedule}
          onAllDayReschedule={requestReschedule}
          onEventClick={openEventFromGrid}
        />
      )}

      {effectiveView === "day" && isDesktop && (
        <CalendarDayView
          focusDate={focusDate}
          events={visibleEvents}
          loading={loading}
          categoryColorByKey={categoryColorByKey}
          interactionEnabled={gridInteraction && !loading}
          fillViewport
          className={gridFillsViewport ? "min-h-0 flex-1" : undefined}
          onSlotClick={openCreateDraft}
          onEventReschedule={requestReschedule}
          onAllDayReschedule={requestReschedule}
          onEventClick={openEventFromGrid}
        />
      )}

      {effectiveView === "day" && !isDesktop && (
        <CalendarAgendaView
          events={dayAgendaEvents}
          loading={loading}
          categoryColorByKey={categoryColorByKey}
          dayHeaderStickyTop={agendaDayHeaderStickyTop}
          onEventClick={openEventFromGrid}
        />
      )}

      {effectiveView === "agenda" && (
        <CalendarAgendaView
          events={visibleEvents}
          loading={loading}
          categoryColorByKey={categoryColorByKey}
          dayHeaderStickyTop={agendaDayHeaderStickyTop}
          onEventClick={openEventFromGrid}
        />
      )}
      </div>

      <CalendarDaySheet
        open={daySheetOpen}
        date={daySheetDate}
        events={visibleEvents}
        categoryColorByKey={categoryColorByKey}
        onClose={() => {
          setDaySheetOpen(false);
          setDaySheetDate(null);
        }}
        onEventClick={(ev) => {
          setDaySheetOpen(false);
          openEventFromGrid(ev);
        }}
        onViewDay={
          daySheetDate && isDesktop
            ? () => {
                setFocusDate(parseLocalDate(daySheetDate));
                persistView("day");
                setDaySheetOpen(false);
              }
            : daySheetDate && !isDesktop
              ? () => {
                  setFocusDate(parseLocalDate(daySheetDate));
                  persistView("agenda");
                  setDaySheetOpen(false);
                }
              : undefined
        }
      />

      <CalendarGoogleSheet
        open={googleSheetOpen}
        onClose={() => setGoogleSheetOpen(false)}
        oauthConfigured={oauthConfigured}
        defaultSyncMode={defaultSyncMode}
        initialConnections={initialConnections}
        publicAppUrl={publicAppUrl}
        oauthFailureMessage={oauthFailureMessage}
        onOpenImport={() => setImportWizardOpen(true)}
      />

      <CalendarImportWizard
        open={importWizardOpen}
        onClose={() => setImportWizardOpen(false)}
        onCommitted={async () => {
          clearImportDeepLink();
          await refreshImportSetup();
          await loadLanes();
          await refreshSyncStatus();
          await loadEvents();
        }}
      />

      <RecurringScopeSheet
        open={recurringPending != null}
        title={recurringPending?.event.title ?? "Event"}
        onCancel={() => setRecurringPending(null)}
        onChoose={(scope) => {
          const pending = recurringPending;
          setRecurringPending(null);
          if (pending) void applyReschedule(pending.event, pending.patch, scope);
        }}
      />

      <CalendarEventSheet
        open={sheetOpen}
        selected={selected}
        createDraft={createDraft}
        defaultCalendarId={defaultCalendarId}
        onClose={() => {
          setSheetOpen(false);
          setSelected(null);
          setCreateDraft(null);
        }}
        onSaved={(ev, isNew) => {
          setEvents((prev) => (isNew ? [...prev, ev] : prev.map((x) => (x.id === ev.id ? ev : x))));
        }}
        onDeleted={(id) => setEvents((prev) => prev.filter((e) => e.id !== id))}
      />
    </div>
  );
}
