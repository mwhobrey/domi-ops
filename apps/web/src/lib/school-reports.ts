export interface CategoryGradeBreakdown {
  categoryId: string | null;
  categoryName: string;
  weightPercent: number;
  averagePercent: number | null;
  gradedCount: number;
}

export interface ClassReportRow {
  classId: string;
  className: string;
  subject: string | null;
  term: string | null;
  assignmentCount: number;
  studentCount: number;
  missingTotal: number;
  overdueTotal: number;
  gradedTotal: number;
  classAveragePercent: number | null;
  weightedClassAveragePercent: number | null;
}

export interface StudentClassReportRow {
  classId: string;
  className: string;
  averagePercent: number | null;
  weightedAveragePercent: number | null;
  categoryBreakdown: CategoryGradeBreakdown[];
  gradedCount: number;
  missingCount: number;
  overdueCount: number;
}

export interface StudentReportRow {
  memberId: string;
  label: string;
  averagePercent: number | null;
  weightedAveragePercent: number | null;
  gradedTotal: number;
  missingTotal: number;
  overdueTotal: number;
  classes: StudentClassReportRow[];
}

export interface MissingWorkItem {
  assignmentId: string;
  assignmentTitle: string;
  classId: string;
  className: string;
  studentMemberId: string;
  studentLabel: string;
  dueAt: string | null;
  status: "missing" | "overdue" | "submitted";
}

export interface ProgressPoint {
  date: string;
  label: string;
  cumulativeAveragePercent: number;
  gradedCount: number;
}

export interface ProgressSeries {
  memberId: string;
  label: string;
  classId: string;
  className: string;
  points: ProgressPoint[];
}

export interface TranscriptAssignmentRow {
  assignmentId: string;
  title: string;
  dueAt: string | null;
  categoryName: string | null;
  score: number | null;
  pointsPossible: number;
  percent: number | null;
  status: string;
}

export interface TranscriptClassRow {
  classId: string;
  className: string;
  subject: string | null;
  term: string | null;
  averagePercent: number | null;
  weightedAveragePercent: number | null;
  categoryBreakdown: CategoryGradeBreakdown[];
  assignments: TranscriptAssignmentRow[];
}

export interface TranscriptStudentRow {
  memberId: string;
  label: string;
  averagePercent: number | null;
  weightedAveragePercent: number | null;
  classes: TranscriptClassRow[];
}

export interface HouseholdReportSummary {
  classCount: number;
  studentCount: number;
  assignmentCount: number;
  missingTotal: number;
  overdueTotal: number;
  gradedTotal: number;
  householdAveragePercent: number | null;
  householdWeightedAveragePercent: number | null;
}

export interface SchoolReportsData {
  summary: HouseholdReportSummary;
  classes: ClassReportRow[];
  students: StudentReportRow[];
  missingDigest: MissingWorkItem[];
  progress: ProgressSeries[];
  transcripts: TranscriptStudentRow[];
  availableTerms: string[];
  selectedTerm: string | null;
  viewMode: "admin" | "staff" | "student" | "observer";
}

export type SchoolReportView =
  | "by-class"
  | "by-student"
  | "weighted"
  | "missing"
  | "progress"
  | "transcript"
  | "weekly";

export function reportsUrl(term: string | null): string {
  if (!term) return "/school/reports";
  return `/school/reports?term=${encodeURIComponent(term)}`;
}
