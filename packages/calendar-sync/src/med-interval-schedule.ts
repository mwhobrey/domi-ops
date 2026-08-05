import {
  addDaysIso,
  formatTimeLabelInTz,
  localDateOfInstant,
  localTimeHhmm,
  todayIsoDateInTz,
  zonedLocalToUtc,
} from "./household-time.js";

export type IntervalStopMode = "max_doses" | "end_time" | "midnight";
export type IntervalAnchor = "first_taken" | "fixed_start";
export type IntervalFrom = "last_taken" | "schedule_grid";

export type IntervalSchedule = {
  everyMinutes: number;
  anchor: IntervalAnchor;
  fixedStartTime?: string;
  intervalFrom: IntervalFrom;
  stop: {
    mode: IntervalStopMode;
    maxDoses?: number;
    endTime?: string;
  };
};

export type IntervalLog = {
  scheduledAt: Date | null;
  loggedAt: Date;
  status: string;
};

export type IntervalPendingDose = {
  scheduledAt: Date;
  scheduledTime: string;
  scheduledTimeLabel: string;
  awaitingFirst: boolean;
};

const MIN_EVERY = 5;
const MAX_EVERY = 24 * 60 * 7;
const MAX_DOSES_CAP = 24;

function parseHhmm(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.includes(":")) return undefined;
  return value.length >= 5 ? value.slice(0, 5) : value;
}

export function parseIntervalSchedule(raw: string | null | undefined): IntervalSchedule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const everyMinutes = Number(parsed.everyMinutes);
    if (!Number.isFinite(everyMinutes) || everyMinutes < MIN_EVERY || everyMinutes > MAX_EVERY) {
      return null;
    }
    const anchor: IntervalAnchor =
      parsed.anchor === "fixed_start" ? "fixed_start" : "first_taken";
    const intervalFrom: IntervalFrom =
      parsed.intervalFrom === "schedule_grid" ? "schedule_grid" : "last_taken";
    const stopRaw = (parsed.stop ?? {}) as Record<string, unknown>;
    const mode: IntervalStopMode =
      stopRaw.mode === "end_time" || stopRaw.mode === "midnight" ? stopRaw.mode : "max_doses";
    const fixedStartTime = parseHhmm(parsed.fixedStartTime);
    if (anchor === "fixed_start" && !fixedStartTime) return null;
    const maxDoses = Number(stopRaw.maxDoses);
    const endTime = parseHhmm(stopRaw.endTime);
    if (mode === "max_doses" && (!Number.isFinite(maxDoses) || maxDoses < 1)) return null;
    if (mode === "end_time" && !endTime) return null;
    return {
      everyMinutes: Math.round(everyMinutes),
      anchor,
      fixedStartTime,
      intervalFrom,
      stop: {
        mode,
        maxDoses: Number.isFinite(maxDoses) ? Math.min(MAX_DOSES_CAP, Math.round(maxDoses)) : undefined,
        endTime,
      },
    };
  } catch {
    return null;
  }
}

export function normalizeIntervalSchedule(input: {
  everyMinutes?: number;
  anchor?: string;
  fixedStartTime?: string;
  intervalFrom?: string;
  stop?: { mode?: string; maxDoses?: number; endTime?: string };
}): IntervalSchedule {
  const everyMinutes = Math.round(Number(input.everyMinutes));
  if (!Number.isFinite(everyMinutes) || everyMinutes < MIN_EVERY || everyMinutes > MAX_EVERY) {
    throw new Error("interval_every_minutes_invalid");
  }
  const anchor: IntervalAnchor = input.anchor === "fixed_start" ? "fixed_start" : "first_taken";
  const intervalFrom: IntervalFrom =
    input.intervalFrom === "schedule_grid" ? "schedule_grid" : "last_taken";
  const fixedStartTime = parseHhmm(input.fixedStartTime);
  if (anchor === "fixed_start" && !fixedStartTime) {
    throw new Error("interval_fixed_start_required");
  }
  const mode: IntervalStopMode =
    input.stop?.mode === "end_time" || input.stop?.mode === "midnight"
      ? input.stop.mode
      : "max_doses";
  const maxDoses = Math.round(Number(input.stop?.maxDoses));
  const endTime = parseHhmm(input.stop?.endTime);
  if (mode === "max_doses") {
    if (!Number.isFinite(maxDoses) || maxDoses < 1 || maxDoses > MAX_DOSES_CAP) {
      throw new Error("interval_max_doses_invalid");
    }
  }
  if (mode === "end_time" && !endTime) {
    throw new Error("interval_end_time_required");
  }
  return {
    everyMinutes,
    anchor,
    fixedStartTime: fixedStartTime,
    intervalFrom,
    stop: {
      mode,
      maxDoses: mode === "max_doses" ? maxDoses : Number.isFinite(maxDoses) ? maxDoses : undefined,
      endTime: mode === "end_time" ? endTime : endTime,
    },
  };
}

function dayEndExclusive(date: string, tz: string, schedule: IntervalSchedule): Date {
  if (schedule.stop.mode === "end_time" && schedule.stop.endTime) {
    return zonedLocalToUtc(date, schedule.stop.endTime, tz);
  }
  // midnight of next day (exclusive end of local day)
  return zonedLocalToUtc(addDaysIso(date, 1), "00:00", tz);
}

function takenToday(logs: IntervalLog[], date: string, tz: string): IntervalLog[] {
  return logs
    .filter((l) => l.status === "taken")
    .filter((l) => localDateOfInstant(l.loggedAt, tz) === date)
    .sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime());
}

function gridStartInstant(
  schedule: IntervalSchedule,
  date: string,
  tz: string,
  firstTaken: IntervalLog | undefined,
): Date | null {
  if (schedule.anchor === "fixed_start" && schedule.fixedStartTime) {
    return zonedLocalToUtc(date, schedule.fixedStartTime, tz);
  }
  if (firstTaken) {
    const hhmm = localTimeHhmm(firstTaken.loggedAt, tz);
    return zonedLocalToUtc(date, hhmm, tz);
  }
  return null;
}

function hasLogForInstant(logs: IntervalLog[], instant: Date): boolean {
  const t = instant.getTime();
  return logs.some((l) => l.scheduledAt != null && Math.abs(l.scheduledAt.getTime() - t) < 60_000);
}

/**
 * Next pending interval dose for local `date` (usually today), or null if done / waiting.
 * When `awaitingFirst`, caller should offer "Start" / first Taken without a prior pending slot.
 */
export function nextIntervalPending(params: {
  schedule: IntervalSchedule;
  tz: string;
  date: string;
  now: Date;
  logs: IntervalLog[];
}): IntervalPendingDose | null {
  const { schedule, tz, date, now, logs } = params;
  const taken = takenToday(logs, date, tz);
  const dayEnd = dayEndExclusive(date, tz, schedule);

  if (schedule.stop.mode === "max_doses" && schedule.stop.maxDoses != null) {
    if (taken.length >= schedule.stop.maxDoses) return null;
  }

  if (taken.length === 0) {
    if (schedule.anchor === "first_taken") {
      return {
        scheduledAt: now,
        scheduledTime: localTimeHhmm(now, tz),
        scheduledTimeLabel: "First dose",
        awaitingFirst: true,
      };
    }
    const start = zonedLocalToUtc(date, schedule.fixedStartTime!, tz);
    if (start >= dayEnd) return null;
    if (hasLogForInstant(logs, start)) return null;
    return {
      scheduledAt: start,
      scheduledTime: schedule.fixedStartTime!,
      scheduledTimeLabel: formatTimeLabelInTz(start, tz),
      awaitingFirst: false,
    };
  }

  if (schedule.intervalFrom === "last_taken") {
    const last = taken[taken.length - 1]!;
    const next = new Date(last.loggedAt.getTime() + schedule.everyMinutes * 60_000);
    if (next >= dayEnd) return null;
    if (schedule.stop.mode === "max_doses" && schedule.stop.maxDoses != null) {
      if (taken.length >= schedule.stop.maxDoses) return null;
    }
    return {
      scheduledAt: next,
      scheduledTime: localTimeHhmm(next, tz),
      scheduledTimeLabel: formatTimeLabelInTz(next, tz),
      awaitingFirst: false,
    };
  }

  // schedule_grid
  const start = gridStartInstant(schedule, date, tz, taken[0]);
  if (!start) return null;
  const maxSlots =
    schedule.stop.mode === "max_doses" && schedule.stop.maxDoses
      ? schedule.stop.maxDoses
      : MAX_DOSES_CAP;
  for (let i = 0; i < maxSlots; i++) {
    const slot = new Date(start.getTime() + i * schedule.everyMinutes * 60_000);
    if (slot >= dayEnd) break;
    if (hasLogForInstant(logs, slot)) continue;
    return {
      scheduledAt: slot,
      scheduledTime: localTimeHhmm(slot, tz),
      scheduledTimeLabel: formatTimeLabelInTz(slot, tz),
      awaitingFirst: false,
    };
  }
  return null;
}

export function intervalDoseInWindow(params: {
  schedule: IntervalSchedule;
  tz: string;
  now: Date;
  logs: IntervalLog[];
  windowEnd: Date;
  lookbackStart: Date;
}): IntervalPendingDose | null {
  const date = todayIsoDateInTz(params.tz);
  const pending = nextIntervalPending({
    schedule: params.schedule,
    tz: params.tz,
    date,
    now: params.now,
    logs: params.logs,
  });
  if (!pending || pending.awaitingFirst) return null;
  if (pending.scheduledAt > params.windowEnd) return null;
  if (pending.scheduledAt < params.lookbackStart) return null;
  return pending;
}
