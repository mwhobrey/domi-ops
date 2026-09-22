import type { CalendarCreateDraft } from "./calendar-utils";
import {
  addMinutesToLocalDateTime,
  DEFAULT_TIMED_EVENT_DURATION_MINUTES,
} from "./event-form-times";

export type ScheduleConflictMode = "at" | "range";

export type ScheduleConflictCheckedWindow = {
  mode: ScheduleConflictMode;
  timeZone: string;
  startAt: string;
  endAt: string;
  adHocBuffer: { beforeMinutes: number; afterMinutes: number } | null;
};

/** Form snapshot the checker UI can hydrate from (dashboard or event sheet). */
export type ScheduleConflictFormState = {
  mode: ScheduleConflictMode;
  date: string;
  time: string;
  rangeStartDate: string;
  rangeStartTime: string;
  rangeEndDate: string;
  rangeEndTime: string;
  bufferBefore: string;
  bufferAfter: string;
  bufferOpen: boolean;
};

export const CALENDAR_NEW_EVENT_QUERY = "newEvent";

export function zonedPartsFromIso(
  iso: string,
  timeZone: string,
): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const hourNum = Number(hour);
  const normalizedHour =
    hourNum === 24 ? "00" : String(hourNum).padStart(2, "0");
  return { date, time: `${normalizedHour}:${minute}` };
}

/** Map in-progress event sheet fields to a checker form (range when duration is known). */
export function eventFormToConflictFormState(args: {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  driveBufferBefore: string;
  driveBufferAfter: string;
}): ScheduleConflictFormState {
  const bufferOpen = Boolean(args.driveBufferBefore || args.driveBufferAfter);
  if (args.allDay) {
    const endDay = args.endDate || args.startDate;
    return {
      mode: "range",
      date: args.startDate,
      time: args.startTime,
      rangeStartDate: args.startDate,
      rangeStartTime: "00:00",
      rangeEndDate: endDay,
      rangeEndTime: "23:59",
      bufferBefore: args.driveBufferBefore,
      bufferAfter: args.driveBufferAfter,
      bufferOpen,
    };
  }

  const endDay = args.endDate || args.startDate;
  const hasDuration =
    args.endTime &&
    (endDay !== args.startDate || args.endTime !== args.startTime);

  if (hasDuration) {
    return {
      mode: "range",
      date: args.startDate,
      time: args.startTime,
      rangeStartDate: args.startDate,
      rangeStartTime: args.startTime,
      rangeEndDate: endDay,
      rangeEndTime: args.endTime,
      bufferBefore: args.driveBufferBefore,
      bufferAfter: args.driveBufferAfter,
      bufferOpen,
    };
  }

  return {
    mode: "at",
    date: args.startDate,
    time: args.startTime,
    rangeStartDate: args.startDate,
    rangeStartTime: args.startTime,
    rangeEndDate: endDay,
    rangeEndTime:
      args.endTime ||
      addMinutesToLocalDateTime(
        args.startDate,
        args.startTime,
        DEFAULT_TIMED_EVENT_DURATION_MINUTES,
      ).time,
    bufferBefore: args.driveBufferBefore,
    bufferAfter: args.driveBufferAfter,
    bufferOpen,
  };
}

export function buildConflictCheckParams(form: ScheduleConflictFormState): URLSearchParams {
  const params = new URLSearchParams({ mode: form.mode });
  if (form.mode === "at") {
    params.set("date", form.date);
    params.set("time", form.time);
  } else {
    params.set("startDate", form.rangeStartDate);
    params.set("startTime", form.rangeStartTime);
    params.set("endDate", form.rangeEndDate);
    params.set("endTime", form.rangeEndTime);
  }
  if (form.bufferOpen && form.bufferBefore) params.set("bufferBeforeMinutes", form.bufferBefore);
  if (form.bufferOpen && form.bufferAfter) params.set("bufferAfterMinutes", form.bufferAfter);
  return params;
}

export function createDraftFromCheckedWindow(
  checked: ScheduleConflictCheckedWindow,
): CalendarCreateDraft {
  const start = zonedPartsFromIso(checked.startAt, checked.timeZone);
  const end = zonedPartsFromIso(checked.endAt, checked.timeZone);
  const pointInstant = checked.startAt === checked.endAt;

  let endDate = end.date;
  let endTime = end.time;
  if (pointInstant) {
    const bumped = addMinutesToLocalDateTime(
      start.date,
      start.time,
      DEFAULT_TIMED_EVENT_DURATION_MINUTES,
    );
    endDate = bumped.date;
    endTime = bumped.time;
  }

  const draft: CalendarCreateDraft = {
    startDate: start.date,
    startTime: start.time,
    allDay: false,
    endDate: endDate !== start.date ? endDate : endDate,
    endTime,
    driveBufferBeforeMinutes: checked.adHocBuffer?.beforeMinutes ?? null,
    driveBufferAfterMinutes: checked.adHocBuffer?.afterMinutes ?? null,
  };

  if (draft.endDate === start.date && draft.endTime === start.time) {
    const bumped = addMinutesToLocalDateTime(
      start.date,
      start.time,
      DEFAULT_TIMED_EVENT_DURATION_MINUTES,
    );
    draft.endTime = bumped.time;
    if (bumped.date !== start.date) draft.endDate = bumped.date;
  }

  return draft;
}

export function calendarCreateDraftToSearchParams(draft: CalendarCreateDraft): URLSearchParams {
  const params = new URLSearchParams({ [CALENDAR_NEW_EVENT_QUERY]: "1" });
  params.set("startDate", draft.startDate);
  params.set("startTime", draft.startTime);
  if (draft.endDate) params.set("endDate", draft.endDate);
  if (draft.endTime) params.set("endTime", draft.endTime);
  if (draft.allDay) params.set("allDay", "1");
  if (draft.driveBufferBeforeMinutes != null && draft.driveBufferBeforeMinutes > 0) {
    params.set("bufferBefore", String(draft.driveBufferBeforeMinutes));
  }
  if (draft.driveBufferAfterMinutes != null && draft.driveBufferAfterMinutes > 0) {
    params.set("bufferAfter", String(draft.driveBufferAfterMinutes));
  }
  return params;
}

export function parseCalendarCreateDraftFromSearchParams(
  params: URLSearchParams,
): CalendarCreateDraft | null {
  if (params.get(CALENDAR_NEW_EVENT_QUERY) !== "1") return null;
  const startDate = params.get("startDate");
  const startTime = params.get("startTime");
  if (!startDate || !startTime) return null;
  const endDate = params.get("endDate") ?? undefined;
  const endTime = params.get("endTime") ?? undefined;
  const allDay = params.get("allDay") === "1";
  const bufferBefore = params.get("bufferBefore");
  const bufferAfter = params.get("bufferAfter");
  return {
    startDate,
    startTime,
    endDate,
    endTime,
    allDay,
    driveBufferBeforeMinutes: bufferBefore ? Number(bufferBefore) : null,
    driveBufferAfterMinutes: bufferAfter ? Number(bufferAfter) : null,
  };
}
