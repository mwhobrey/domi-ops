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

export interface AttendanceDays {
  daysAttended: number;
  daysRecorded: number;
  daysAbsent: number;
  daysExcused: number;
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
  attendance: {
    days: AttendanceDays;
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
  attendance: AttendanceDays;
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
