export type AttendanceStatus = "present" | "late" | "absent" | "excused";

export const ATTENDANCE_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
  { value: "excused", label: "Excused" },
];

export interface AttendanceRow {
  studentMemberId: string;
  attendanceDate: string;
  status: AttendanceStatus;
  note: string | null;
}

export interface RecordStudent {
  memberId: string;
  label: string;
  canEdit: boolean;
}

/** One school day for a student and why it counts. */
export interface DayActivity {
  date: string;
  /** Someone marked "school happened". */
  marked: boolean;
  /** Minutes in the hours log. */
  minutes: number;
  /** A class marked the student present or late. */
  classAttendance: boolean;
}

export interface GradeBand {
  min: number;
  letter: string;
  points: number;
}

export interface GradeScale {
  passingPercent: number;
  bands: GradeBand[];
}

export interface RecordsSettings {
  schoolDaysTarget: number | null;
  gradeScale: GradeScale;
  gradeScaleIsDefault: boolean;
  gradeScalePresets: { id: string; label: string; scale: GradeScale }[];
  canEdit: boolean;
}

export interface HoursEntry {
  id: string;
  classId: string | null;
  logDate: string;
  minutes: number;
  activity: string;
  note: string;
}

export interface StudentRecords {
  student: { memberId: string; label: string };
  canEdit: boolean;
  classes: { id: string; name: string }[];
  instruction: { days: DayActivity[]; count: number; target: number | null };
  attendance: {
    perClass: {
      classId: string;
      className: string;
      present: number;
      late: number;
      absent: number;
      excused: number;
      recorded: number;
    }[];
  };
  hours: { entries: HoursEntry[]; totalMinutes: number; totalHours: number };
}

export interface TranscriptCourse {
  classId: string;
  name: string;
  subject: string | null;
  credits: number;
  finalPercent: number | null;
  letter: string | null;
  creditsEarned: number;
  inProgress: boolean;
}

export interface TranscriptData {
  student: { memberId: string; label: string };
  householdName: string;
  range: { from: string | null; to: string | null };
  transcript: {
    gpa: number | null;
    creditsAttempted: number;
    creditsEarned: number;
    terms: {
      term: string | null;
      gpa: number | null;
      creditsEarned: number;
      courses: TranscriptCourse[];
    }[];
  };
  gradeScale: GradeScale;
  daysOfInstruction: number;
  hours: { totalMinutes: number; totalHours: number };
  generatedAt: string;
}

/** Jul 1 to Jun 30 around `today` (YYYY-MM-DD). Homeschool years rarely follow the calendar year. */
export function schoolYearRange(today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const start = m >= 7 ? y : y - 1;
  return { from: `${start}-07-01`, to: `${start + 1}-06-30` };
}

export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours}`;
}

/** Pulls the server's message out of a failed settings save, if it sent one. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const body = (err as { body?: string } | null)?.body;
  if (!body) return fallback;
  try {
    const parsed = JSON.parse(body) as { message?: string };
    return parsed.message ?? fallback;
  } catch {
    return fallback;
  }
}

/** Sunday-first weeks covering a month, as YYYY-MM-DD strings, with nulls for padding. */
export function monthGrid(month: string): (string | null)[][] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Monday to Friday of the week containing `ymd`. */
export function weekdaysOfWeek(ymd: string): { from: string; to: string } {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay();
  const monday = new Date(d.getTime() - ((dow + 6) % 7) * 86_400_000);
  const friday = new Date(monday.getTime() + 4 * 86_400_000);
  return { from: monday.toISOString().slice(0, 10), to: friday.toISOString().slice(0, 10) };
}
