/** Default timed calendar event length when end is unset or still the auto default. */
export const DEFAULT_TIMED_EVENT_DURATION_MINUTES = 60;

export function addMinutesToLocalDateTime(
  date: string,
  time: string,
  minutes: number,
): { date: string; time: string } {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const base = new Date(y, m - 1, d, hh, mm, 0, 0);
  base.setMinutes(base.getMinutes() + minutes);
  return {
    date: `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`,
    time: `${String(base.getHours()).padStart(2, "0")}:${String(base.getMinutes()).padStart(2, "0")}`,
  };
}

function localDateTimeToMs(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

function diffMinutes(
  fromDate: string,
  fromTime: string,
  toDate: string,
  toTime: string,
): number {
  return (localDateTimeToMs(toDate, toTime) - localDateTimeToMs(fromDate, fromTime)) / 60_000;
}

/**
 * When the user moves a timed event's start, keep a sensible end:
 * snap to start + 1h if end was empty, invalid (end ≤ start), or still the prior default slot;
 * otherwise preserve the custom duration from the previous start.
 */
export function adjustTimedEventEndOnStartChange(args: {
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousStartTime: string;
  newStartDate: string;
  newStartTime: string;
  endTime: string;
}): { endTime: string; endDate: string } {
  const endDay = args.endDate || args.startDate;
  const defaultEndPrev = addMinutesToLocalDateTime(
    args.previousStartDate,
    args.previousStartTime,
    DEFAULT_TIMED_EVENT_DURATION_MINUTES,
  );
  const defaultEndNew = addMinutesToLocalDateTime(
    args.newStartDate,
    args.newStartTime,
    DEFAULT_TIMED_EVENT_DURATION_MINUTES,
  );

  const hadDefaultEnd =
    args.endTime === defaultEndPrev.time && endDay === defaultEndPrev.date;

  const endInvalid =
    !args.endTime ||
    diffMinutes(args.previousStartDate, args.previousStartTime, endDay, args.endTime) <= 0;

  if (endInvalid || hadDefaultEnd) {
    return { endTime: defaultEndNew.time, endDate: defaultEndNew.date };
  }

  const durationMin = diffMinutes(
    args.previousStartDate,
    args.previousStartTime,
    endDay,
    args.endTime,
  );
  const preserved = addMinutesToLocalDateTime(
    args.newStartDate,
    args.newStartTime,
    durationMin,
  );
  return { endTime: preserved.time, endDate: preserved.date };
}
