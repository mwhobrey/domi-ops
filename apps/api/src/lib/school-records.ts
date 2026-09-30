// Pure helpers for homeschool records: attendance tallies and hours totals. No DB here, so
// the rules a parent might be audited on are unit-tested (school-records.test.ts).

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return typeof value === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

/** YYYY-MM-DD that is also a real calendar date (rejects 2026-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface AttendanceRow {
  classId: string;
  studentMemberId: string;
  attendanceDate: string;
  status: AttendanceStatus;
}

export interface AttendanceTally {
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Class sessions recorded, any status. */
  recorded: number;
}

export function emptyTally(): AttendanceTally {
  return { present: 0, late: 0, absent: 0, excused: 0, recorded: 0 };
}

export function tallyAttendance(rows: Pick<AttendanceRow, "status">[]): AttendanceTally {
  const t = emptyTally();
  for (const r of rows) {
    t[r.status] += 1;
    t.recorded += 1;
  }
  return t;
}

/** One school day for a student and why it counts. */
export interface DayActivity {
  date: string;
  /** Someone marked "school happened" on this day. */
  marked: boolean;
  /** Minutes logged in the hours log. */
  minutes: number;
  /** A class marked the student present or late. */
  classAttendance: boolean;
}

/**
 * Days of instruction, the number states ask for. Homeschoolers rarely take a roll call, so a
 * day counts if ANY of these is true: it was marked as a school day, hours were logged, or a
 * class marked the student present/late. Absent and excused marks never count for or against.
 * Returned sorted by date; length is the day count.
 */
export function buildDayActivity(input: {
  markedDays: string[];
  hours: Pick<HoursRow, "logDate" | "minutes">[];
  attendance: Pick<AttendanceRow, "attendanceDate" | "status">[];
}): DayActivity[] {
  const byDate = new Map<string, DayActivity>();
  const get = (date: string) => {
    let d = byDate.get(date);
    if (!d) {
      d = { date, marked: false, minutes: 0, classAttendance: false };
      byDate.set(date, d);
    }
    return d;
  };
  for (const date of input.markedDays) get(date).marked = true;
  for (const h of input.hours) {
    if (h.minutes > 0) get(h.logDate).minutes += h.minutes;
  }
  for (const a of input.attendance) {
    if (a.status === "present" || a.status === "late") get(a.attendanceDate).classAttendance = true;
  }
  return [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date));
}

/** Monday to Friday dates from `from` through `to`, inclusive. */
export function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += 86_400_000) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface HoursRow {
  logDate: string;
  minutes: number;
  classId: string | null;
}

export function totalMinutes(rows: Pick<HoursRow, "minutes">[]): number {
  return rows.reduce((sum, r) => sum + r.minutes, 0);
}

/** Hours to one decimal place, e.g. 90 -> 1.5. */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

/** Accepts whole minutes in 1..1440 (a day). */
export function parseMinutes(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 1 && value <= 1440 ? value : null;
}
