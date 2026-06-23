"use client";



import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/cn";

import { eventColors, resolveEventColor } from "../../lib/calendar-event-colors";

import { spanDayRole } from "../../lib/calendar-event-span";

import type { CalendarEventView } from "../../lib/calendar-utils";

import {

  addDays,

  eventChipTitle,

  formatDateLocal,

  isEventEditable,

  isEventResizable,

} from "../../lib/calendar-utils";

import {

  buildResizePatch,

  buildResizeStartPatch,

  buildAllDayReschedulePatch,

  buildReschedulePatch,

  columnIndexFromClientX,

  eventsForDate,

  heightPxFromDuration,

  snapEndOffsetYToMinutes,

  snapStartOffsetYToMinutes,

  topPxFromMinutes,

  formatHourLabel,

  gridTotalHeightPx,

  hourSlots,

  isViewingToday,

  layoutTimedEvent,

  layoutTimedEvents,

  parseTimeToMinutes,

  partitionDayEvents,

  scrollTopForNow,

  snapOffsetYToMinutes,

  MIN_EVENT_DURATION_MIN,

  SLOT_HEIGHT_PX,

  type ReschedulePatch,

} from "../../lib/calendar-time-grid";



function formatDayHeader(d: Date): string {

  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

}



type ResizeEdge = "start" | "end";



function CalendarResizeDot({

  edge,

  ariaLabel,

  dotColor,

  visible,

  onPointerDown,

  onPointerMove,

  onPointerUp,

  onPointerCancel,

}: {

  edge: ResizeEdge;

  ariaLabel: string;

  dotColor: string;

  visible: boolean;

  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;

  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;

  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;

  onPointerCancel: () => void;

}) {

  return (

    <div

      role="separator"

      aria-label={ariaLabel}

      data-resize-handle={edge}

      className={cn(

        "absolute left-1/2 z-40 h-2.5 w-2.5 -translate-x-1/2 cursor-ns-resize touch-none rounded-full",

        "transition-[opacity,transform] hover:scale-125 hover:brightness-110 active:brightness-90",

        edge === "start" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2",

        visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",

      )}

      style={{ backgroundColor: dotColor }}

      onPointerDown={onPointerDown}

      onPointerMove={onPointerMove}

      onPointerUp={onPointerUp}

      onPointerCancel={onPointerCancel}

    />

  );

}



type DragPreview = {

  event: CalendarEventView;

  dateKey: string;

  topPx: number;

};



type ResizePreview = {

  eventId: string;

  topPx: number;

  heightPx: number;

  startMinutes: number;

  endMinutes: number;

};



export function CalendarTimeGrid({

  dates,

  events,

  loading,

  onEventClick,

  scrollToNow = false,

  interactionEnabled = false,

  onSlotClick,

  onEventReschedule,

  onAllDayReschedule,

  categoryColorByKey,

  fillViewport = false,

  className,

}: {

  dates: Date[];

  events: CalendarEventView[];

  categoryColorByKey?: Map<string, string | null>;

  loading?: boolean;

  onEventClick: (ev: CalendarEventView) => void;

  scrollToNow?: boolean;

  interactionEnabled?: boolean;

  onSlotClick?: (date: string, hour: number) => void;

  onEventReschedule?: (ev: CalendarEventView, patch: ReschedulePatch) => void;

  /** Stretch grid to fill remaining calendar viewport height. */

  fillViewport?: boolean;

  className?: string;

  onAllDayReschedule?: (ev: CalendarEventView, patch: ReschedulePatch) => void;

}) {

  const scrollRef = useRef<HTMLDivElement>(null);

  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);

  const allDayColumnRefs = useRef<(HTMLDivElement | null)[]>([]);

  const dragMovedRef = useRef(false);

  const allDayDragMovedRef = useRef(false);

  const allDayDragEventRef = useRef<CalendarEventView | null>(null);

  const resizeMovedRef = useRef(false);

  const resizeRef = useRef<{

    event: CalendarEventView;

    edge: ResizeEdge;

    colIndex: number;

    fixedStartMin: number;

    fixedEndMin: number;

    originTopPx: number;

    originHeightPx: number;

  } | null>(null);

  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);

  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);

  const [allDayDragDateKey, setAllDayDragDateKey] = useState<string | null>(null);

  const [allDayBandHeight, setAllDayBandHeight] = useState(40);

  const dateKeys = useMemo(() => dates.map((d) => formatDateLocal(d)), [dates]);

  const colCount = dates.length;

  const showNow = scrollToNow && isViewingToday(dateKeys);



  useEffect(() => {

    if (!showNow || !scrollRef.current) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    scrollRef.current.scrollTo({ top: scrollTopForNow(), behavior: reduced ? "auto" : "smooth" });

  }, [showNow, dateKeys.join(",")]);



  const columns = useMemo(() => {

    return dateKeys.map((key, i) => {

      const dayEvents = eventsForDate(events, key);

      const { allDay, timed } = partitionDayEvents(dayEvents);

      const layouts = layoutTimedEvents(timed).map((layout, index) => ({

        ...layout,

        zIndex: 10 + index,

      }));

      return {

        key,

        date: dates[i]!,

        allDay,

        layouts,

      };

    });

  }, [dateKeys, dates, events]);

  const allDayEventCount = useMemo(
    () => columns.reduce((n, col) => n + col.allDay.length, 0),
    [columns],
  );

  useEffect(() => {
    const els = allDayColumnRefs.current.filter(
      (el): el is HTMLDivElement => el != null,
    );
    if (els.length === 0 || typeof ResizeObserver === "undefined") return;

    function measure() {
      const max = Math.max(...els.map((el) => el.getBoundingClientRect().height));
      if (max > 0) setAllDayBandHeight(max);
    }

    measure();
    const observer = new ResizeObserver(measure);
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, [colCount, allDayEventCount]);

  const hours = hourSlots();

  const bodyHeight = gridTotalHeightPx();



  const getColumnRects = useCallback(() => {

    return columnRefs.current

      .filter((el): el is HTMLDivElement => el != null)

      .map((el) => el.getBoundingClientRect());

  }, []);



  const resolveDrop = useCallback(

    (clientX: number, clientY: number) => {

      const rects = getColumnRects();

      const colIndex = columnIndexFromClientX(

        rects.map((r) => ({ left: r.left, right: r.right })),

        clientX,

      );

      if (colIndex == null) return null;

      const colEl = columnRefs.current[colIndex];

      if (!colEl) return null;

      const rect = colEl.getBoundingClientRect();

      const offsetY = clientY - rect.top;

      const minutes = snapOffsetYToMinutes(offsetY);

      return { dateKey: dateKeys[colIndex]!, minutes, topPx: (minutes / 60) * SLOT_HEIGHT_PX };

    },

    [dateKeys, getColumnRects],

  );



  const endDrag = useCallback(

    (ev: CalendarEventView, clientX: number, clientY: number) => {

      if (!dragMovedRef.current) return;

      const drop = resolveDrop(clientX, clientY);

      if (drop && onEventReschedule) {

        const patch = buildReschedulePatch(ev, drop.dateKey, drop.minutes);

        onEventReschedule(ev, patch);

      }

      dragMovedRef.current = false;

      setDragPreview(null);

    },

    [onEventReschedule, resolveDrop],

  );



  const resolveAllDayColumn = useCallback(

    (clientX: number) => {

      const rects = allDayColumnRefs.current

        .filter((el): el is HTMLDivElement => el != null)

        .map((el) => el.getBoundingClientRect());

      const colIndex = columnIndexFromClientX(

        rects.map((r) => ({ left: r.left, right: r.right })),

        clientX,

      );

      if (colIndex == null) return null;

      return dateKeys[colIndex] ?? null;

    },

    [dateKeys],

  );



  const endAllDayDrag = useCallback(

    (clientX: number) => {

      const ev = allDayDragEventRef.current;

      if (!ev || !allDayDragMovedRef.current || !onAllDayReschedule) return;

      const dateKey = resolveAllDayColumn(clientX);

      if (dateKey && dateKey !== ev.startDate) {

        onAllDayReschedule(ev, buildAllDayReschedulePatch(ev, dateKey));

      }

      allDayDragMovedRef.current = false;

      allDayDragEventRef.current = null;

      setAllDayDragDateKey(null);

    },

    [onAllDayReschedule, resolveAllDayColumn],

  );



  const onPointerMove = useCallback(

    (e: React.PointerEvent, ev: CalendarEventView) => {

      if (e.buttons === 0 || resizeRef.current) return;

      const drop = resolveDrop(e.clientX, e.clientY);

      if (!drop) return;

      dragMovedRef.current = true;

      setDragPreview({ event: ev, dateKey: drop.dateKey, topPx: drop.topPx });

    },

    [resolveDrop],

  );



  const beginResize = useCallback(

    (

      edge: ResizeEdge,

      colIndex: number,

      event: CalendarEventView,

      topPx: number,

      heightPx: number,

      e: React.PointerEvent<HTMLDivElement>,

    ) => {

      e.stopPropagation();

      dragMovedRef.current = false;

      resizeMovedRef.current = false;

      const startMin = parseTimeToMinutes(event.startTime) ?? 0;

      const endMin =

        parseTimeToMinutes(event.endTime) ?? startMin + MIN_EVENT_DURATION_MIN;

      resizeRef.current = {

        event,

        edge,

        colIndex,

        fixedStartMin: startMin,

        fixedEndMin: endMin,

        originTopPx: topPx,

        originHeightPx: heightPx,

      };

      setResizePreview({

        eventId: event.id,

        topPx,

        heightPx,

        startMinutes: startMin,

        endMinutes: endMin,

      });

      e.currentTarget.setPointerCapture(e.pointerId);

    },

    [],

  );



  const endResize = useCallback(

    (ev: CalendarEventView) => {

      if (!resizeMovedRef.current || !resizePreview || !onEventReschedule) {

        resizeRef.current = null;

        setResizePreview(null);

        resizeMovedRef.current = false;

        return;

      }

      const patch =

        resizeRef.current?.edge === "start"

          ? buildResizeStartPatch(ev, resizePreview.startMinutes)

          : buildResizePatch(ev, resizePreview.endMinutes);

      onEventReschedule(ev, patch);

      resizeRef.current = null;

      setResizePreview(null);

      resizeMovedRef.current = false;

    },

    [onEventReschedule, resizePreview],

  );



  const onResizePointerMove = useCallback((e: React.PointerEvent) => {

    const state = resizeRef.current;

    if (!state || e.buttons === 0) return;

    const colEl = columnRefs.current[state.colIndex];

    if (!colEl) return;

    const offsetY = e.clientY - colEl.getBoundingClientRect().top;

    let startMin = state.fixedStartMin;

    let endMin = state.fixedEndMin;

    if (state.edge === "end") {

      endMin = snapEndOffsetYToMinutes(state.fixedStartMin, offsetY);

    } else {

      startMin = snapStartOffsetYToMinutes(state.fixedEndMin, offsetY);

    }

    resizeMovedRef.current = true;

    setResizePreview({

      eventId: state.event.id,

      topPx: topPxFromMinutes(startMin),

      heightPx: heightPxFromDuration(endMin - startMin),

      startMinutes: startMin,

      endMinutes: endMin,

    });

  }, []);



  return (

    <div

      ref={scrollRef}

      className={cn(
        "overflow-y-auto overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--color-border)]",
        fillViewport
          ? "min-h-0 max-h-[calc(100dvh-var(--header-height)-var(--calendar-chrome-height))]"
          : "max-h-[min(70vh,calc(100dvh-var(--header-height)-12rem))]",
        className,
      )}

      aria-label="Calendar time grid"

    >

      <div

        className="grid min-w-full"

        style={{ gridTemplateColumns: `3.5rem repeat(${colCount}, minmax(5rem, 1fr))` }}

      >

        <div className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-2 text-xs text-[var(--color-text-muted)]">

          All day

        </div>

        {columns.map((col, colIndex) => (

          <div

            key={`allday-${col.key}`}

            ref={(el) => {

              allDayColumnRefs.current[colIndex] = el;

            }}

            data-allday-col={col.key}

            className={cn(

              "sticky top-0 z-20 min-h-[2.5rem] border-b border-l border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-1",

              allDayDragDateKey === col.key && "ring-1 ring-inset ring-[var(--color-accent)]",

            )}

          >

            {col.allDay.map((ev) => {

              const editable = interactionEnabled && isEventEditable(ev);

              const isDragging = allDayDragDateKey != null && allDayDragEventRef.current?.id === ev.id;

              const role = spanDayRole(ev, col.key);

              const continued = role === "middle" || role === "end";

              const colors = eventColors(
                resolveEventColor(ev, categoryColorByKey ?? new Map()),
              );

              return (

                <button

                  key={ev.id}

                  type="button"

                  className={cn(

                    "mb-1 block w-full truncate px-1 py-0.5 text-left text-xs",

                    role === "single" || role === "start" ? "rounded" : "rounded-none",

                    role === "start" && "rounded-r-none",

                    role === "end" && "rounded-l-none",

                    role === "middle" && "opacity-85",

                    editable && "cursor-grab touch-none active:cursor-grabbing",

                    isDragging && "opacity-50",

                  )}

                  style={colors}

                  title={
                    continued
                      ? `${eventChipTitle(ev)} (continued)`
                      : eventChipTitle(ev)
                  }

                  onClick={() => {

                    if (allDayDragMovedRef.current) return;

                    onEventClick(ev);

                  }}

                  onPointerDown={

                    editable && onAllDayReschedule

                      ? (e) => {

                          allDayDragMovedRef.current = false;

                          allDayDragEventRef.current = ev;

                          e.currentTarget.setPointerCapture(e.pointerId);

                        }

                      : undefined

                  }

                  onPointerMove={

                    editable && onAllDayReschedule

                      ? (e) => {

                          if (e.buttons === 0) return;

                          const dateKey = resolveAllDayColumn(e.clientX);

                          if (!dateKey) return;

                          allDayDragMovedRef.current = true;

                          setAllDayDragDateKey(dateKey);

                        }

                      : undefined

                  }

                  onPointerUp={

                    editable && onAllDayReschedule

                      ? (e) => {

                          e.currentTarget.releasePointerCapture(e.pointerId);

                          endAllDayDrag(e.clientX);

                        }

                      : undefined

                  }

                  onPointerCancel={

                    editable

                      ? () => {

                          allDayDragMovedRef.current = false;

                          allDayDragEventRef.current = null;

                          setAllDayDragDateKey(null);

                        }

                      : undefined

                  }

                >

                  {continued ? "… " : ""}
                  <span className="block truncate">{ev.title}</span>
                  {ev.categoryLabel && (
                    <span className="block truncate text-[10px] font-normal opacity-90">
                      {ev.categoryLabel}
                    </span>
                  )}

                </button>

              );

            })}

          </div>

        ))}



        <div
          className="sticky z-20 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
          style={{ top: allDayBandHeight }}
        />

        {columns.map((col) => (

          <div

            key={`hdr-${col.key}`}

            className="sticky z-20 border-b border-l border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-2 text-center text-sm font-medium"

            style={{ top: allDayBandHeight }}

          >

            {formatDayHeader(col.date)}

          </div>

        ))}



        <div className="relative border-r border-[var(--color-border)]">

          {hours.map((h) => (

            <div

              key={h}

              className="border-b border-[var(--color-border)]/50 px-2 text-right text-xs text-[var(--color-text-muted)]"

              style={{ height: SLOT_HEIGHT_PX }}

            >

              {formatHourLabel(h)}

            </div>

          ))}

        </div>



        {columns.map((col, colIndex) => (

          <div

            key={`col-${col.key}`}

            ref={(el) => {

              columnRefs.current[colIndex] = el;

            }}

            className="relative border-l border-[var(--color-border)]"

            style={{ height: bodyHeight }}

          >

            {interactionEnabled &&

              onSlotClick &&

              hours.map((h) => (

                <button

                  key={`slot-${h}`}

                  type="button"

                  className="absolute left-0 right-0 z-0 border-0 bg-transparent hover:bg-[var(--color-accent-subtle)]/20"

                  style={{

                    top: (h - hours[0]!) * SLOT_HEIGHT_PX,

                    height: SLOT_HEIGHT_PX,

                  }}

                  aria-label={`Create event on ${formatDayHeader(col.date)} at ${formatHourLabel(h)}`}

                  onClick={() => onSlotClick(col.key, h)}

                />

              ))}

            {hours.map((h) => (

              <div

                key={`line-${h}`}

                className="pointer-events-none absolute left-0 right-0 border-b border-[var(--color-border)]/30"

                style={{ top: (h - hours[0]!) * SLOT_HEIGHT_PX, height: SLOT_HEIGHT_PX }}

              />

            ))}

            {col.layouts.map(({ event, topPx, heightPx, zIndex }) => {

              const colors = eventColors(
                resolveEventColor(event, categoryColorByKey ?? new Map()),
              );

              const editable = interactionEnabled && isEventEditable(event);

              const resizable = editable && isEventResizable(event) && !!onEventReschedule;

              const isDragging = dragPreview?.event.id === event.id;

              const isResizing = resizePreview?.eventId === event.id;

              const displayTop =

                isResizing && resizePreview ? resizePreview.topPx : topPx;

              const displayHeight =

                isResizing && resizePreview ? resizePreview.heightPx : heightPx;

              const pendingBorder =

                event.syncStatus === "pending"

                  ? "ring-1 ring-inset ring-dashed ring-[var(--color-accent)]"

                  : "";

              const showResizeDots =

                resizable &&

                (hoveredEventId === event.id || resizePreview?.eventId === event.id);

              return (

                <div

                  key={event.id}

                  className={cn(

                    "group/event absolute left-1 right-1 overflow-visible",

                    editable ? "z-20" : "z-10",

                  )}

                  style={{

                    top: displayTop,

                    height: displayHeight,

                    minHeight: 24,

                    zIndex,

                  }}

                  onMouseEnter={() => setHoveredEventId(event.id)}

                  onMouseLeave={() => setHoveredEventId((id) => (id === event.id ? null : id))}

                >

                  <button

                    type="button"

                    aria-grabbed={isDragging || undefined}

                    className={cn(

                      "relative h-full w-full overflow-hidden rounded-md px-2 py-1 text-left text-xs font-medium shadow-sm hover:opacity-90",

                      editable ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer",

                      isDragging && "opacity-40",

                      pendingBorder,

                    )}

                    style={{

                      background: colors.background,

                      color: colors.color,

                    }}

                    title={eventChipTitle(event)}

                    onClick={() => {

                      if (dragMovedRef.current || resizeMovedRef.current) return;

                      onEventClick(event);

                    }}

                    onPointerDown={

                      editable && onEventReschedule

                        ? (e) => {

                            if ((e.target as HTMLElement).dataset.resizeHandle) return;

                            dragMovedRef.current = false;

                            e.currentTarget.setPointerCapture(e.pointerId);

                          }

                        : undefined

                    }

                    onPointerMove={

                      editable && onEventReschedule

                        ? (e) => onPointerMove(e, event)

                        : undefined

                    }

                    onPointerUp={

                      editable && onEventReschedule

                        ? (e) => {

                            e.currentTarget.releasePointerCapture(e.pointerId);

                            endDrag(event, e.clientX, e.clientY);

                          }

                        : undefined

                    }

                    onPointerCancel={

                      editable

                        ? () => {

                            dragMovedRef.current = false;

                            setDragPreview(null);

                          }

                        : undefined

                    }

                  >

                    <span className="line-clamp-2 leading-tight">{event.title}</span>
                    {event.categoryLabel && displayHeight >= 36 && (
                      <span className="block truncate text-[10px] font-normal leading-tight opacity-90">
                        {event.categoryLabel}
                      </span>
                    )}

                  </button>

                  {resizable && (

                    <>

                      <CalendarResizeDot

                        edge="start"

                        ariaLabel="Resize event start time"

                        dotColor={colors.background}

                        visible={showResizeDots}

                        onPointerDown={(e) => beginResize("start", colIndex, event, topPx, heightPx, e)}

                        onPointerMove={onResizePointerMove}

                        onPointerUp={(e) => {

                          e.currentTarget.releasePointerCapture(e.pointerId);

                          endResize(event);

                        }}

                        onPointerCancel={() => {

                          resizeRef.current = null;

                          setResizePreview(null);

                          resizeMovedRef.current = false;

                        }}

                      />

                      <CalendarResizeDot

                        edge="end"

                        ariaLabel="Resize event end time"

                        dotColor={colors.background}

                        visible={showResizeDots}

                        onPointerDown={(e) => beginResize("end", colIndex, event, topPx, heightPx, e)}

                        onPointerMove={onResizePointerMove}

                        onPointerUp={(e) => {

                          e.currentTarget.releasePointerCapture(e.pointerId);

                          endResize(event);

                        }}

                        onPointerCancel={() => {

                          resizeRef.current = null;

                          setResizePreview(null);

                          resizeMovedRef.current = false;

                        }}

                      />

                    </>

                  )}

                </div>

              );

            })}

            {dragPreview && dragPreview.dateKey === col.key && (

              <div

                className="pointer-events-none absolute left-1 right-1 z-30 rounded-md border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent-subtle)]/40 px-2 py-1 text-xs font-medium"

                style={{

                  top: dragPreview.topPx,

                  height: layoutTimedEvent(dragPreview.event).heightPx,

                  minHeight: 24,

                }}

                aria-hidden

              >

                {dragPreview.event.title}

              </div>

            )}

          </div>

        ))}

      </div>

      {loading && (

        <p className="border-t border-[var(--color-border)] p-2 text-sm text-[var(--color-text-muted)]">

          Loading…

        </p>

      )}

    </div>

  );

}



export function weekDates(weekStart: Date): Date[] {

  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

}

