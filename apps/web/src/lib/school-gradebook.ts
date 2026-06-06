export type GradebookCellStatus =
  | "missing"
  | "overdue"
  | "submitted"
  | "graded"
  | "not_assigned";

export interface GradebookAssignmentColumn {
  id: string;
  title: string;
  dueAt: string | null;
  pointsPossible: number;
  visibility: string;
  categoryId?: string | null;
}

export interface GradebookStudentCell {
  assignmentId: string;
  status: GradebookCellStatus;
  score: number | null;
  percent: number | null;
  missing: boolean;
  overdue: boolean;
  gradedAt?: string | null;
}

export interface GradebookStudentRow {
  memberId: string;
  enrollmentId: string;
  cells: GradebookStudentCell[];
  gradedCount: number;
  missingCount: number;
  overdueCount: number;
  averagePercent: number | null;
}

export interface GradebookSummary {
  assignmentCount: number;
  studentCount: number;
  missingTotal: number;
  overdueTotal: number;
  gradedTotal: number;
  classAveragePercent: number | null;
}

export interface GradebookData {
  summary: GradebookSummary;
  assignments: GradebookAssignmentColumn[];
  students: GradebookStudentRow[];
}

const STATUS_LABEL: Record<GradebookCellStatus, string> = {
  missing: "Missing",
  overdue: "Overdue",
  submitted: "Submitted",
  graded: "Graded",
  not_assigned: "Not assigned",
};

const STATUS_TONE: Record<
  GradebookCellStatus,
  "default" | "success" | "warning" | "accent"
> = {
  missing: "warning",
  overdue: "warning",
  submitted: "accent",
  graded: "success",
  not_assigned: "default",
};

export function gradebookCellLabel(status: GradebookCellStatus): string {
  return STATUS_LABEL[status] ?? status;
}

export function gradebookCellTone(
  status: GradebookCellStatus,
): "default" | "success" | "warning" | "accent" {
  return STATUS_TONE[status] ?? "default";
}

export function formatGradebookPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
}

export function formatGradebookScore(
  score: number | null,
  pointsPossible: number,
): string {
  if (score == null) return "—";
  return `${score}/${pointsPossible}`;
}
