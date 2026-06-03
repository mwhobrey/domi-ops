export interface MappedEventFields {
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  timeZone: string | null;
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
    googleEventId: event.id ? String(event.id) : null,
    googleRecurringEventId: event.recurringEventId
      ? String(event.recurringEventId)
      : null,
    googleEtag: event.etag ? String(event.etag) : null,
    categoryKey: inferSourceCategory(event),
    color: null,
  };
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
