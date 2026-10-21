export type EventTimeRange = {
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
};

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function seconds(value: string): number | null {
  if (!/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) return null;
  const [h, m, s = 0] = value.split(":").map(Number);
  return h < 24 && m < 60 && s < 60 ? h * 3600 + m * 60 + s : null;
}

export function eventTimeRangeError(event: EventTimeRange): string | null {
  if (!validDate(event.startDate) || (event.endDate && !validDate(event.endDate))) {
    return "Enter a valid start and end date.";
  }
  const endDate = event.endDate || event.startDate;
  if (endDate < event.startDate) return "End date must be on or after start date.";
  if (event.allDay || !event.startTime) return null;
  const start = seconds(event.startTime);
  const end = event.endTime ? seconds(event.endTime) : null;
  if (start === null || (event.endTime && end === null)) return "Enter valid event times.";
  if (end !== null && endDate === event.startDate && end <= start) {
    return "End time must be after start time. For an overnight event, choose the next end date.";
  }
  return null;
}

/** Calendar arithmetic on wall-clock values; independent of the server's time zone. */
export function defaultEventEnd(date: string, time: string): { date: string; time: string } {
  const clock = time.length >= 8 ? time.slice(0, 8) : `${time}:00`;
  const end = new Date(`${date}T${clock}Z`);
  end.setUTCMinutes(end.getUTCMinutes() + 60);
  return { date: end.toISOString().slice(0, 10), time: end.toISOString().slice(11, 19) };
}
