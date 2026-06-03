export interface CalendarEventView {
  id: string;
  title: string;
  startDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  color: string | null;
  calendarId: string;
}

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

export function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function weekRange(weekStart: Date): { from: string; to: string } {
  const end = addDays(weekStart, 6);
  return { from: formatDateISO(weekStart), to: formatDateISO(end) };
}
