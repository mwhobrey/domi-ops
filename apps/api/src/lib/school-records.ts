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

export interface SchoolDaySummary {
  /** Distinct dates the student attended at least one class (present or late). */
  daysAttended: number;
  /** Distinct dates with any attendance recorded. */
  daysRecorded: number;
  /** Recorded dates where every entry was absent (excused days are neither attended nor counted against). */
  daysAbsent: number;
  daysExcused: number;
}

/**
 * Household-level "school days" for one student across all their classes. A day counts as attended
 * if any class marked them present or late; absent only if every entry that day was absent.
 * Days that are only excused (or excused plus absent) count as excused, not absent.
 */
export function summarizeSchoolDays(rows: Pick<AttendanceRow, "attendanceDate" | "status">[]): SchoolDaySummary {
  const byDate = new Map<string, Set<AttendanceStatus>>();
  for (const r of rows) {
    const set = byDate.get(r.attendanceDate) ?? new Set<AttendanceStatus>();
    set.add(r.status);
    byDate.set(r.attendanceDate, set);
  }
  let daysAttended = 0;
  let daysAbsent = 0;
  let daysExcused = 0;
  for (const statuses of byDate.values()) {
    if (statuses.has("present") || statuses.has("late")) daysAttended += 1;
    else if (statuses.has("excused")) daysExcused += 1;
    else daysAbsent += 1;
  }
  return { daysAttended, daysRecorded: byDate.size, daysAbsent, daysExcused };
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
