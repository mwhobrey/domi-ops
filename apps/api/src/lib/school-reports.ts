import type { Database } from "@whome/db";
import { schoolAssignmentCategories, schoolClasses } from "@whome/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  isHouseholdAdmin,
  type SchoolViewMode,
  visibleClassIdsForMember,
  type MemberEnrollmentRow,
} from "./school-access.js";
import { buildClassGradebook } from "./school-gradebook.js";
import {
  buildMissingWorkItems,
  buildProgressSeries,
  buildTranscriptClassRow,
  computeWeightedGrade,
  type CategoryGradeBreakdown,
  type MissingWorkItem,
  type ProgressPoint,
  type TranscriptStudentRow,
} from "./school-report-math.js";

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

export interface ProgressSeries {
  memberId: string;
  label: string;
  classId: string;
  className: string;
  points: ProgressPoint[];
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
  viewMode: SchoolViewMode;
}

export async function buildSchoolReports(params: {
  db: Database;
  householdId: string;
  memberId: string;
  householdRole: string;
  viewMode: SchoolViewMode;
  enrollments: MemberEnrollmentRow[];
  memberLabels: Map<string, string>;
  termFilter?: string | null;
}): Promise<SchoolReportsData> {
  const { db, householdId, memberId, householdRole, viewMode, enrollments, memberLabels, termFilter } =
    params;

  const classRows = await db
    .select()
    .from(schoolClasses)
    .where(and(eq(schoolClasses.householdId, householdId), eq(schoolClasses.archived, false)));

  const availableTerms = [...new Set(classRows.map((c) => c.term).filter((t): t is string => Boolean(t)))]
    .sort((a, b) => a.localeCompare(b));

  const visibleIds = new Set(
    visibleClassIdsForMember({
      memberId,
      householdRole,
      classes: classRows.map((c) => ({
        id: c.id,
        teacherMemberId: c.teacherMemberId,
        archived: c.archived ?? false,
      })),
      enrollments,
    }),
  );

  let visibleClasses = classRows.filter((c) => visibleIds.has(c.id));
  if (termFilter) {
    visibleClasses = visibleClasses.filter((c) => c.term === termFilter);
  }

  const isStudentView = viewMode === "student";
  const classIds = visibleClasses.map((c) => c.id);

  const categoryRows =
    classIds.length > 0
      ? await db
          .select()
          .from(schoolAssignmentCategories)
          .where(inArray(schoolAssignmentCategories.classId, classIds))
      : [];

  const categoriesByClass = new Map<string, typeof categoryRows>();
  for (const row of categoryRows) {
    if (!row.classId) continue;
    const list = categoriesByClass.get(row.classId) ?? [];
    list.push(row);
    categoriesByClass.set(row.classId, list);
  }

  const classes: ClassReportRow[] = [];
  const studentAgg = new Map<
    string,
    {
      classes: StudentClassReportRow[];
      gradedTotal: number;
      missingTotal: number;
      overdueTotal: number;
      classAverages: number[];
      weightedAverages: number[];
    }
  >();
  const missingDigest: MissingWorkItem[] = [];
  const progress: ProgressSeries[] = [];
  const transcriptMap = new Map<string, TranscriptStudentRow>();

  let assignmentCount = 0;
  let missingTotal = 0;
  let overdueTotal = 0;
  let gradedTotal = 0;
  const classAverages: number[] = [];
  const weightedClassAverages: number[] = [];

  for (const cls of visibleClasses) {
    const gradebook = await buildClassGradebook(db, cls.id);
    const categories = (categoriesByClass.get(cls.id) ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      weightPercent: c.weightPercent,
    }));
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
    const assignmentInputs = gradebook.assignments.map((a) => ({
      id: a.id,
      title: a.title,
      categoryId: a.categoryId,
      pointsPossible: a.pointsPossible,
      visibility: a.visibility,
      dueAt: a.dueAt,
    }));

    const studentRows = isStudentView
      ? gradebook.students.filter((s) => s.memberId === memberId)
      : gradebook.students;

    if (studentRows.length === 0 && isStudentView) continue;

    const classWeightedAvgs: number[] = [];

    for (const student of studentRows) {
      const cellInputs = student.cells.map((c) => ({
        assignmentId: c.assignmentId,
        status: c.status,
        score: c.score,
        gradedAt: c.gradedAt,
      }));
      const { weightedAveragePercent, breakdown } = computeWeightedGrade(
        categories,
        assignmentInputs,
        cellInputs,
      );
      const weighted = weightedAveragePercent ?? student.averagePercent;
      const label = memberLabels.get(student.memberId) ?? student.memberId.slice(0, 8);

      if (weighted != null) classWeightedAvgs.push(weighted);

      missingDigest.push(
        ...buildMissingWorkItems({
          classId: cls.id,
          className: cls.name,
          assignments: assignmentInputs,
          studentMemberId: student.memberId,
          studentLabel: label,
          cells: cellInputs,
        }),
      );

      const seriesPoints = buildProgressSeries(assignmentInputs, cellInputs);
      if (seriesPoints.length > 0) {
        progress.push({
          memberId: student.memberId,
          label,
          classId: cls.id,
          className: cls.name,
          points: seriesPoints,
        });
      }

      const transcriptClass = buildTranscriptClassRow({
        classId: cls.id,
        className: cls.name,
        subject: cls.subject,
        term: cls.term,
        categories,
        assignments: assignmentInputs,
        cells: cellInputs,
        categoryNameById,
      });

      const existingTranscript = transcriptMap.get(student.memberId) ?? {
        memberId: student.memberId,
        label,
        averagePercent: null,
        weightedAveragePercent: null,
        classes: [],
      };
      existingTranscript.classes.push(transcriptClass);
      transcriptMap.set(student.memberId, existingTranscript);

      const bucket = studentAgg.get(student.memberId) ?? {
        classes: [],
        gradedTotal: 0,
        missingTotal: 0,
        overdueTotal: 0,
        classAverages: [],
        weightedAverages: [],
      };
      bucket.classes.push({
        classId: cls.id,
        className: cls.name,
        averagePercent: student.averagePercent,
        weightedAveragePercent: weighted,
        categoryBreakdown: breakdown,
        gradedCount: student.gradedCount,
        missingCount: student.missingCount,
        overdueCount: student.overdueCount,
      });
      bucket.gradedTotal += student.gradedCount;
      bucket.missingTotal += student.missingCount;
      bucket.overdueTotal += student.overdueCount;
      if (student.averagePercent != null) bucket.classAverages.push(student.averagePercent);
      if (weighted != null) bucket.weightedAverages.push(weighted);
      studentAgg.set(student.memberId, bucket);
    }

    const classSummary = isStudentView ? studentRows[0] : null;

    const classAveragePercent = isStudentView
      ? (classSummary?.averagePercent ?? null)
      : gradebook.summary.classAveragePercent;

    const weightedClassAveragePercent = isStudentView
      ? (studentAgg.get(memberId)?.classes.find((c) => c.classId === cls.id)?.weightedAveragePercent ??
        null)
      : classWeightedAvgs.length > 0
        ? Math.round(
            (classWeightedAvgs.reduce((sum, v) => sum + v, 0) / classWeightedAvgs.length) * 10,
          ) / 10
        : null;

    classes.push({
      classId: cls.id,
      className: cls.name,
      subject: cls.subject,
      term: cls.term,
      assignmentCount: gradebook.summary.assignmentCount,
      studentCount: isStudentView ? (studentRows.length > 0 ? 1 : 0) : gradebook.summary.studentCount,
      missingTotal: isStudentView ? (classSummary?.missingCount ?? 0) : gradebook.summary.missingTotal,
      overdueTotal: isStudentView ? (classSummary?.overdueCount ?? 0) : gradebook.summary.overdueTotal,
      gradedTotal: isStudentView ? (classSummary?.gradedCount ?? 0) : gradebook.summary.gradedTotal,
      classAveragePercent,
      weightedClassAveragePercent,
    });

    assignmentCount += gradebook.summary.assignmentCount;
    missingTotal += isStudentView ? (classSummary?.missingCount ?? 0) : gradebook.summary.missingTotal;
    overdueTotal += isStudentView ? (classSummary?.overdueCount ?? 0) : gradebook.summary.overdueTotal;
    gradedTotal += isStudentView ? (classSummary?.gradedCount ?? 0) : gradebook.summary.gradedTotal;
    if (classAveragePercent != null) classAverages.push(classAveragePercent);
    if (weightedClassAveragePercent != null) weightedClassAverages.push(weightedClassAveragePercent);
  }

  const students: StudentReportRow[] = [...studentAgg.entries()]
    .map(([id, data]) => ({
      memberId: id,
      label: memberLabels.get(id) ?? id.slice(0, 8),
      averagePercent:
        data.classAverages.length > 0
          ? Math.round(
              (data.classAverages.reduce((sum, v) => sum + v, 0) / data.classAverages.length) * 10,
            ) / 10
          : null,
      weightedAveragePercent:
        data.weightedAverages.length > 0
          ? Math.round(
              (data.weightedAverages.reduce((sum, v) => sum + v, 0) / data.weightedAverages.length) *
                10,
            ) / 10
          : null,
      gradedTotal: data.gradedTotal,
      missingTotal: data.missingTotal,
      overdueTotal: data.overdueTotal,
      classes: data.classes.sort((a, b) => a.className.localeCompare(b.className)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  for (const transcript of transcriptMap.values()) {
    const classAvgs = transcript.classes
      .map((c) => c.averagePercent)
      .filter((v): v is number => v != null);
    const weightedAvgs = transcript.classes
      .map((c) => c.weightedAveragePercent)
      .filter((v): v is number => v != null);
    transcript.averagePercent =
      classAvgs.length > 0
        ? Math.round((classAvgs.reduce((sum, v) => sum + v, 0) / classAvgs.length) * 10) / 10
        : null;
    transcript.weightedAveragePercent =
      weightedAvgs.length > 0
        ? Math.round((weightedAvgs.reduce((sum, v) => sum + v, 0) / weightedAvgs.length) * 10) / 10
        : null;
    transcript.classes.sort((a, b) => a.className.localeCompare(b.className));
  }

  const transcripts = [...transcriptMap.values()].sort((a, b) => a.label.localeCompare(b.label));

  missingDigest.sort((a, b) => {
    const priority = { overdue: 0, missing: 1, submitted: 2 };
    const pa = priority[a.status];
    const pb = priority[b.status];
    if (pa !== pb) return pa - pb;
    const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const dbTime = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return da - dbTime;
  });

  progress.sort(
    (a, b) => a.label.localeCompare(b.label) || a.className.localeCompare(b.className),
  );

  return {
    summary: {
      classCount: classes.length,
      studentCount: isStudentView ? 1 : studentAgg.size,
      assignmentCount,
      missingTotal,
      overdueTotal,
      gradedTotal,
      householdAveragePercent:
        classAverages.length > 0
          ? Math.round((classAverages.reduce((sum, v) => sum + v, 0) / classAverages.length) * 10) /
            10
          : null,
      householdWeightedAveragePercent:
        weightedClassAverages.length > 0
          ? Math.round(
              (weightedClassAverages.reduce((sum, v) => sum + v, 0) / weightedClassAverages.length) *
                10,
            ) / 10
          : null,
    },
    classes: classes.sort((a, b) => a.className.localeCompare(b.className)),
    students,
    missingDigest,
    progress,
    transcripts,
    availableTerms,
    selectedTerm: termFilter ?? null,
    viewMode,
  };
}

export function canViewSchoolReports(viewMode: SchoolViewMode, householdRole: string): boolean {
  if (isHouseholdAdmin(householdRole)) return true;
  return viewMode === "staff" || viewMode === "student" || viewMode === "observer";
}
