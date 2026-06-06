export interface CategoryDef {
  id: string;
  name: string;
  weightPercent: number;
}

export interface AssignmentGradeInput {
  id: string;
  title: string;
  categoryId: string | null;
  pointsPossible: number;
  visibility: string;
  dueAt: string | null;
}

export interface CellGradeInput {
  assignmentId: string;
  status: string;
  score: number | null;
  gradedAt: string | null;
}

export interface CategoryGradeBreakdown {
  categoryId: string | null;
  categoryName: string;
  weightPercent: number;
  averagePercent: number | null;
  gradedCount: number;
}

export interface ProgressPoint {
  date: string;
  label: string;
  cumulativeAveragePercent: number;
  gradedCount: number;
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

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computePointsAverage(
  assignments: AssignmentGradeInput[],
  cells: CellGradeInput[],
): number | null {
  let earned = 0;
  let possible = 0;
  for (const assignment of assignments) {
    if (assignment.visibility === "draft") continue;
    const cell = cells.find((c) => c.assignmentId === assignment.id);
    if (!cell || cell.score == null) continue;
    earned += cell.score;
    possible += assignment.pointsPossible;
  }
  return possible > 0 ? roundPercent((earned / possible) * 100) : null;
}

export function computeWeightedGrade(
  categories: CategoryDef[],
  assignments: AssignmentGradeInput[],
  cells: CellGradeInput[],
): { weightedAveragePercent: number | null; breakdown: CategoryGradeBreakdown[] } {
  const categoryStats = new Map<
    string | null,
    { earned: number; possible: number; count: number }
  >();

  for (const assignment of assignments) {
    if (assignment.visibility === "draft") continue;
    const cell = cells.find((c) => c.assignmentId === assignment.id);
    if (!cell || cell.score == null) continue;
    const key = assignment.categoryId;
    const bucket = categoryStats.get(key) ?? { earned: 0, possible: 0, count: 0 };
    bucket.earned += cell.score;
    bucket.possible += assignment.pointsPossible;
    bucket.count += 1;
    categoryStats.set(key, bucket);
  }

  const breakdown: CategoryGradeBreakdown[] = [];
  let weightedSum = 0;
  let weightTotal = 0;

  for (const category of categories) {
    const stats = categoryStats.get(category.id);
    const averagePercent =
      stats && stats.possible > 0 ? roundPercent((stats.earned / stats.possible) * 100) : null;
    breakdown.push({
      categoryId: category.id,
      categoryName: category.name,
      weightPercent: category.weightPercent,
      averagePercent,
      gradedCount: stats?.count ?? 0,
    });
    if (averagePercent != null && category.weightPercent > 0) {
      weightedSum += averagePercent * category.weightPercent;
      weightTotal += category.weightPercent;
    }
  }

  const uncategorized = categoryStats.get(null);
  if (uncategorized && uncategorized.possible > 0) {
    breakdown.push({
      categoryId: null,
      categoryName: "Uncategorized",
      weightPercent: 0,
      averagePercent: roundPercent((uncategorized.earned / uncategorized.possible) * 100),
      gradedCount: uncategorized.count,
    });
  }

  const weightedAveragePercent =
    weightTotal > 0 ? roundPercent(weightedSum / weightTotal) : null;

  return { weightedAveragePercent, breakdown };
}

export function buildProgressSeries(
  assignments: AssignmentGradeInput[],
  cells: CellGradeInput[],
): ProgressPoint[] {
  const graded = assignments
    .filter((a) => a.visibility !== "draft")
    .map((assignment) => {
      const cell = cells.find((c) => c.assignmentId === assignment.id);
      if (!cell || cell.score == null) return null;
      const sortDate = cell.gradedAt ?? assignment.dueAt ?? null;
      return {
        assignment,
        cell,
        sortDate: sortDate ? new Date(sortDate).getTime() : 0,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => a.sortDate - b.sortDate || a.assignment.title.localeCompare(b.assignment.title));

  let earned = 0;
  let possible = 0;
  const points: ProgressPoint[] = [];

  for (const row of graded) {
    earned += row.cell.score!;
    possible += row.assignment.pointsPossible;
    const dateIso =
      row.cell.gradedAt ??
      row.assignment.dueAt ??
      new Date(row.sortDate || Date.now()).toISOString();
    points.push({
      date: dateIso,
      label: row.assignment.title,
      cumulativeAveragePercent: roundPercent((earned / possible) * 100),
      gradedCount: points.length + 1,
    });
  }

  return points;
}

export function buildMissingWorkItems(params: {
  classId: string;
  className: string;
  assignments: AssignmentGradeInput[];
  studentMemberId: string;
  studentLabel: string;
  cells: CellGradeInput[];
}): MissingWorkItem[] {
  const items: MissingWorkItem[] = [];
  for (const assignment of params.assignments) {
    if (assignment.visibility === "draft") continue;
    const cell = params.cells.find((c) => c.assignmentId === assignment.id);
    const status = cell?.status ?? "missing";
    if (status !== "missing" && status !== "overdue" && status !== "submitted") continue;
    items.push({
      assignmentId: assignment.id,
      assignmentTitle: assignment.title,
      classId: params.classId,
      className: params.className,
      studentMemberId: params.studentMemberId,
      studentLabel: params.studentLabel,
      dueAt: assignment.dueAt,
      status,
    });
  }
  return items.sort((a, b) => {
    const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const db = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return da - db || a.assignmentTitle.localeCompare(b.assignmentTitle);
  });
}

export function buildTranscriptClassRow(params: {
  classId: string;
  className: string;
  subject: string | null;
  term: string | null;
  categories: CategoryDef[];
  assignments: AssignmentGradeInput[];
  cells: CellGradeInput[];
  categoryNameById: Map<string, string>;
}): TranscriptClassRow {
  const averagePercent = computePointsAverage(params.assignments, params.cells);
  const { weightedAveragePercent, breakdown } = computeWeightedGrade(
    params.categories,
    params.assignments,
    params.cells,
  );

  const assignments: TranscriptAssignmentRow[] = params.assignments
    .filter((a) => a.visibility !== "draft")
    .map((assignment) => {
      const cell = params.cells.find((c) => c.assignmentId === assignment.id);
      const score = cell?.score ?? null;
      const percent =
        score != null && assignment.pointsPossible > 0
          ? roundPercent((score / assignment.pointsPossible) * 100)
          : null;
      return {
        assignmentId: assignment.id,
        title: assignment.title,
        dueAt: assignment.dueAt,
        categoryName: assignment.categoryId
          ? (params.categoryNameById.get(assignment.categoryId) ?? null)
          : null,
        score,
        pointsPossible: assignment.pointsPossible,
        percent,
        status: cell?.status ?? "missing",
      };
    })
    .sort((a, b) => {
      const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const db = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return da - db || a.title.localeCompare(b.title);
    });

  return {
    classId: params.classId,
    className: params.className,
    subject: params.subject,
    term: params.term,
    averagePercent,
    weightedAveragePercent: weightedAveragePercent ?? averagePercent,
    categoryBreakdown: breakdown,
    assignments,
  };
}
