export type CalendarEventSource = "local" | "google";

export type CalendarEventSyncStatus = "synced" | "pending" | "conflict" | "error";

/** Shared calendar event DTO (API GET/PATCH + week/day grid). */
export interface CalendarEventView {
  id: string;
  title: string;
  description?: string | null;
  startDate: string;
  endDate?: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  color: string | null;
  categoryKey?: string | null;
  categoryLabel?: string | null;
  timeZone?: string | null;
  calendarId: string;
  source?: CalendarEventSource;
  googleEventId?: string | null;
  /** Server-computed; when false, grid drag/resize and PATCH are blocked. */
  editable?: boolean;
  /** Server-computed; when true, schedule PATCH enqueues Google push. */
  pushable?: boolean;
  syncStatus?: CalendarEventSyncStatus;
  recurringRuleId?: string | null;
  reminderOffsets?: number[];
}

export type RepeatFreq = "none" | "daily" | "weekly" | "monthly";

export type RepeatRuleInput = {
  freq: RepeatFreq;
  interval?: number;
  until?: string;
  count?: number;
};

/** Events the user may drag on the week/day grid (timed or all-day). Prefer API `editable` when present. */
export function isEventEditable(ev: CalendarEventView): boolean {
  if (ev.editable === false) return false;
  if (ev.editable === true) return true;
  if (ev.syncStatus === "conflict") return false;
  return true;
}

export function isEventResizable(ev: CalendarEventView): boolean {
  return isEventEditable(ev);
}

/** @deprecated Use isEventEditable */
export function isEventDraggable(ev: CalendarEventView): boolean {
  return isEventEditable(ev);
}

/** Hover text for grid chips — includes category when set. */
export function eventChipTitle(ev: CalendarEventView): string {
  const parts = [ev.categoryLabel ? `${ev.title} · ${ev.categoryLabel}` : ev.title];
  const sync = eventInteractionTitle(ev);
  if (sync) parts.push(sync);
  return parts.join("\n");
}

export function eventInteractionTitle(ev: CalendarEventView): string | undefined {
  if (!isEventEditable(ev)) {
    if (ev.syncStatus === "conflict") return "Sync conflict — resolve in event details";
    return undefined;
  }
  if (ev.source === "google" || ev.googleEventId) {
    if (ev.pushable) return "Drag or resize — changes sync to Google";
    if (ev.syncStatus === "pending") return "Syncing to Google…";
    return "Saved in whome only (enable bidirectional sync to update Google)";
  }
  return undefined;
}

export type CalendarCreateDraft = {
  startDate: string;
  startTime: string;
  allDay: boolean;
};

export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** @deprecated Prefer formatDateLocal for UI date keys (avoids UTC shift). */
export function formatDateISO(d: Date): string {
  return formatDateLocal(d);
}

export function weekRange(weekStart: Date): { from: string; to: string } {
  const end = addDays(weekStart, 6);
  return { from: formatDateLocal(weekStart), to: formatDateLocal(end) };
}

export function dayRange(d: Date): { from: string; to: string } {
  const iso = formatDateLocal(d);
  return { from: iso, to: iso };
}

/** Agenda loads from start of focus week through +30 days. */
export function agendaRange(focusDate: Date): { from: string; to: string } {
  const from = formatDateLocal(startOfWeek(focusDate));
  const to = formatDateLocal(addDays(focusDate, 30));
  return { from, to };
}

export function searchRange(): { from: string; to: string } {
  return {
    from: formatDateLocal(addDays(new Date(), -30)),
    to: formatDateLocal(addDays(new Date(), 365)),
  };
}

export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export type CalendarViewMode = "month" | "week" | "day" | "agenda";

export const CALENDAR_VIEW_STORAGE_KEY = "whome:calendar-view";

export function readStoredCalendarView(): CalendarViewMode {
  if (typeof sessionStorage === "undefined") return "week";
  const stored = sessionStorage.getItem(CALENDAR_VIEW_STORAGE_KEY);
  if (stored === "month" || stored === "week" || stored === "day" || stored === "agenda") {
    return stored;
  }
  return "week";
}

/** Local calendar date (avoids UTC shift from toISOString). */
export function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

export function endOfMonth(monthStart: Date): Date {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
}

export type MonthCell = {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
};

/** Sunday-start month grid with leading/trailing padding days. */
export function monthGrid(monthStart: Date): MonthCell[] {
  const today = formatDateLocal(new Date());
  const first = startOfMonth(monthStart);
  const last = endOfMonth(first);
  const cells: MonthCell[] = [];
  const startPad = first.getDay();
  for (let i = 0; i < startPad; i++) {
    const d = addDays(first, i - startPad);
    cells.push({
      date: formatDateLocal(d),
      day: d.getDate(),
      inMonth: false,
      isToday: formatDateLocal(d) === today,
    });
  }
  for (let day = 1; day <= last.getDate(); day++) {
    const d = new Date(first.getFullYear(), first.getMonth(), day);
    const date = formatDateLocal(d);
    cells.push({ date, day, inMonth: true, isToday: date === today });
  }
  while (cells.length % 7 !== 0) {
    const d = addDays(last, cells.length - startPad - last.getDate() + 1);
    cells.push({
      date: formatDateLocal(d),
      day: d.getDate(),
      inMonth: false,
      isToday: formatDateLocal(d) === today,
    });
  }
  return cells;
}

export function monthRange(monthStart: Date): { from: string; to: string } {
  const last = endOfMonth(monthStart);
  return { from: formatDateLocal(monthStart), to: formatDateLocal(last) };
}
