import { defaultEventEnd, eventTimeRangeError } from "./event-time.js";
import {
  googleRemindersBody,
  offsetsFromGoogleEvent,
} from "./event-reminders.js";

export interface MappedEventFields {
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  timeZone: string | null;
  location: string | null;
  googleEventId: string | null;
  googleRecurringEventId: string | null;
  googleEtag: string | null;
  categoryKey: string | null;
  color: string | null;
}

function parseGoogleDt(
  value: string,
  tzName: string,
): { date: string; time: string | null; allDay: boolean } {
  if (!value) {
    const d = new Date().toISOString().slice(0, 10);
    return { date: d, time: null, allDay: true };
  }
  if (value.includes("T")) {
    try {
      const dt = new Date(value);
      const local = dt.toLocaleString("en-US", { timeZone: tzName, hour12: false });
      const parts = local.split(", ")[1]?.split(":") ?? [];
      const date = dt.toLocaleDateString("en-CA", { timeZone: tzName });
      const time =
        parts.length >= 2
          ? `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`
          : null;
      return { date, time, allDay: false };
    } catch {
      return { date: new Date().toISOString().slice(0, 10), time: null, allDay: false };
    }
  }
  return { date: value.slice(0, 10), time: null, allDay: true };
}

export function inferSourceCategory(event: Record<string, unknown>): string {
  const eventType = String(event.eventType ?? "").toLowerCase();
  if (eventType) return eventType;
  const colorId = String(event.colorId ?? "").trim();
  if (colorId) return `google_color_${colorId}`;
  return "default";
}

export function eventToFields(
  event: Record<string, unknown>,
  tzName: string,
): MappedEventFields {
  const start = (event.start as Record<string, string>) ?? {};
  const end = (event.end as Record<string, string>) ?? {};
  const eventTz = start.timeZone ?? end.timeZone ?? tzName;

  let startDate: string;
  let startTime: string | null;
  let allDay: boolean;

  if (start.date) {
    startDate = start.date.slice(0, 10);
    startTime = null;
    allDay = true;
  } else {
    const parsed = parseGoogleDt(start.dateTime ?? "", eventTz);
    startDate = parsed.date;
    startTime = parsed.time;
    allDay = parsed.allDay;
  }

  let endDate: string | null = null;
  let endTime: string | null = null;
  if (end.date) {
    const exclusive = new Date(end.date);
    exclusive.setDate(exclusive.getDate() - 1);
    endDate = exclusive.toISOString().slice(0, 10);
  } else if (end.dateTime) {
    const parsed = parseGoogleDt(end.dateTime, eventTz);
    endDate = parsed.date;
    endTime = parsed.time;
  }

  return {
    title: String(event.summary ?? "Untitled").slice(0, 256),
    description: event.description ? String(event.description) : null,
    startDate,
    endDate,
    startTime,
    endTime,
    allDay,
    timeZone: eventTz,
    location: event.location ? String(event.location).slice(0, 512) : null,
    googleEventId: event.id ? String(event.id) : null,
    googleRecurringEventId: event.recurringEventId
      ? String(event.recurringEventId)
      : null,
    googleEtag: event.etag ? String(event.etag) : null,
    categoryKey: inferSourceCategory(event),
    color: null,
  };
}

export type WhomeEventForGoogle = {
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  timeZone: string | null;
  location?: string | null;
  reminderOffsets?: number[];
};

/** Build Google Calendar API event body from a Domi Ops event row. */
export function eventToGoogleBody(
  event: WhomeEventForGoogle,
  tzName: string,
): Record<string, unknown> {
  const rangeError = eventTimeRangeError(event);
  if (rangeError) throw new Error(rangeError);
  const tz = event.timeZone ?? tzName;
  const body: Record<string, unknown> = {
    summary: event.title,
    description: event.description ?? "",
  };
  if (event.location !== undefined) body.location = event.location ?? "";
  const reminders = googleRemindersBody(event.reminderOffsets ?? []);
  if (reminders) body.reminders = reminders;
  if (event.allDay || !event.startTime) {
    body.start = { date: event.startDate };
    const endBase = event.endDate ?? event.startDate;
    const endD = new Date(`${endBase}T00:00:00Z`);
    endD.setUTCDate(endD.getUTCDate() + 1);
    body.end = { date: endD.toISOString().slice(0, 10) };
    return body;
  }
  const startIso = `${event.startDate}T${event.startTime.length >= 8 ? event.startTime.slice(0, 8) : `${event.startTime}:00`}`;
  const fallback = defaultEventEnd(event.endDate ?? event.startDate, event.startTime);
  const endDate = event.endDate ?? (event.endTime ? event.startDate : fallback.date);
  const endTime = event.endTime ?? fallback.time;
  const endIso = `${event.endTime ? endDate : fallback.date}T${endTime.length >= 8 ? endTime.slice(0, 8) : `${endTime}:00`}`;
  body.start = { dateTime: startIso, timeZone: tz };
  body.end = { dateTime: endIso, timeZone: tz };
  return body;
}

export function syncWindow(): { timeMin: string; timeMax: string } {
  const today = new Date();
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 1);
  const end = new Date(today);
  end.setFullYear(end.getFullYear() + 1);
  return {
    timeMin: `${start.toISOString().slice(0, 10)}T00:00:00Z`,
    timeMax: `${end.toISOString().slice(0, 10)}T23:59:59Z`,
  };
}
