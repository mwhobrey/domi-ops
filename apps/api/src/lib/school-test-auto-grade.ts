import type { Database } from "@domi-ops/db";
import {
  schoolAssignmentMaterials,
  schoolAssignments,
  schoolGrades,
  schoolSubmissionResponses,
  schoolSubmissions,
  schoolTestQuestions,
} from "@domi-ops/db";
import { and, asc, eq } from "drizzle-orm";
import {
  effectiveQuestionScore,
  questionMaxPoints,
  rollupTestScore,
  scoreQuestion,
  type GradableQuestion,
} from "./school-test-grading.js";
import type { SchoolNativeTestPointsMode, SchoolQuestionType } from "./school-test-questions.js";

export type ApplyAutoGradeResult = {
  needsManualGrade: boolean;
  score: number | null;
  gradedQuestionCount: number;
  materialCount: number;
};

function toGradable(row: typeof schoolTestQuestions.$inferSelect): GradableQuestion {
  return {
    id: row.id,
    questionType: row.questionType as SchoolQuestionType,
    points: row.points,
    weight: row.weight,
    correctAnswerJson: row.correctAnswerJson,
  };
}

/**
 * Auto-grade native-test responses for the current turn-in.
 * Writes auto_score on response rows; upserts school_grades when fully scored.
 */
export async function applyNativeTestAutoGrade(
  db: Database,
  params: {
    submissionId: string;
    assignmentId: string;
    turnInNumber: number;
    gradedByUserId?: string | null;
    /** When true (teacher review recompute), keep existing manualScore overrides. */
    preserveManualScores?: boolean;
  },
): Promise<ApplyAutoGradeResult> {
  const [assignmentRow] = await db
    .select()
    .from(schoolAssignments)
    .where(eq(schoolAssignments.id, params.assignmentId))
    .limit(1);
  if (!assignmentRow) {
    return { needsManualGrade: false, score: null, gradedQuestionCount: 0, materialCount: 0 };
  }

  const materials = await db
    .select()
    .from(schoolAssignmentMaterials)
    .where(
      and(
        eq(schoolAssignmentMaterials.assignmentId, params.assignmentId),
        eq(schoolAssignmentMaterials.source, "native_test"),
      ),
    );
  if (materials.length === 0) {
    return { needsManualGrade: false, score: null, gradedQuestionCount: 0, materialCount: 0 };
  }

  const rollupRows: Array<{
    autoScore: number | null;
    manualScore: number | null;
    needsManual: boolean;
  }> = [];
  let gradedQuestionCount = 0;
  const now = new Date();

  for (const material of materials) {
    const pointsMode = (material.nativeTestPointsMode ?? "explicit") as SchoolNativeTestPointsMode;
    const questions = await db
      .select()
      .from(schoolTestQuestions)
      .where(eq(schoolTestQuestions.materialId, material.id))
      .orderBy(asc(schoolTestQuestions.sortOrder));
    if (questions.length === 0) continue;

    const gradable = questions.map(toGradable);
    const responses = await db
      .select()
      .from(schoolSubmissionResponses)
      .where(
        and(
          eq(schoolSubmissionResponses.submissionId, params.submissionId),
          eq(schoolSubmissionResponses.materialId, material.id),
          eq(schoolSubmissionResponses.turnInNumber, params.turnInNumber),
        ),
      );
    const byQuestion = new Map(responses.map((r) => [r.questionId, r]));

    for (const question of questions) {
      const gq = toGradable(question);
      const existing = byQuestion.get(question.id);
      const result = scoreQuestion(
        gq,
        existing?.responseJson ?? null,
        pointsMode,
        assignmentRow.pointsPossible,
        gradable,
      );
      gradedQuestionCount += 1;

      if (existing) {
        const manualScore = params.preserveManualScores ? existing.manualScore : null;
        await db
          .update(schoolSubmissionResponses)
          .set({
            autoScore: result.autoScore,
            manualScore,
            gradedByUserId: params.preserveManualScores ? existing.gradedByUserId : null,
            gradedAt:
              manualScore != null || result.autoScore != null
                ? existing.gradedAt ?? now
                : null,
            updatedAt: now,
          })
          .where(eq(schoolSubmissionResponses.id, existing.id));
        rollupRows.push({
          autoScore: result.autoScore,
          manualScore,
          needsManual: result.needsManualGrade && manualScore == null,
        });
      } else {
        const [inserted] = await db
          .insert(schoolSubmissionResponses)
          .values({
            submissionId: params.submissionId,
            materialId: material.id,
            questionId: question.id,
            turnInNumber: params.turnInNumber,
            responseJson: {},
            autoScore: result.autoScore,
            manualScore: null,
            gradedAt: result.autoScore != null ? now : null,
          })
          .returning();
        void inserted;
        rollupRows.push({
          autoScore: result.autoScore,
          manualScore: null,
          needsManual: result.needsManualGrade,
        });
      }
    }
  }

  if (rollupRows.length === 0) {
    return { needsManualGrade: false, score: null, gradedQuestionCount: 0, materialCount: materials.length };
  }

  const rollup = rollupTestScore(rollupRows);
  if (rollup.needsManualGrade) {
    const [existing] = await db
      .select()
      .from(schoolGrades)
      .where(eq(schoolGrades.submissionId, params.submissionId))
      .limit(1);
    if (existing) {
      await db
        .update(schoolGrades)
        .set({
          score: null,
          gradedByUserId: params.gradedByUserId ?? existing.gradedByUserId,
          gradedAt: new Date(),
        })
        .where(eq(schoolGrades.id, existing.id));
    }
    await db
      .update(schoolSubmissions)
      .set({ status: "submitted", updatedAt: new Date() })
      .where(eq(schoolSubmissions.id, params.submissionId));
  } else {
    await upsertSubmissionGrade(db, {
      submissionId: params.submissionId,
      score: rollup.score,
      needsManualGrade: false,
      gradedByUserId: params.gradedByUserId ?? null,
    });
  }

  return {
    needsManualGrade: rollup.needsManualGrade,
    score: rollup.score,
    gradedQuestionCount,
    materialCount: materials.length,
  };
}

export async function recomputeNativeTestRollup(
  db: Database,
  params: {
    submissionId: string;
    assignmentId: string;
    turnInNumber: number;
    gradedByUserId: string;
  },
): Promise<{ score: number | null; needsManualGrade: boolean }> {
  const [assignmentRow] = await db
    .select()
    .from(schoolAssignments)
    .where(eq(schoolAssignments.id, params.assignmentId))
    .limit(1);
  if (!assignmentRow) return { score: null, needsManualGrade: false };

  const materials = await db
    .select()
    .from(schoolAssignmentMaterials)
    .where(
      and(
        eq(schoolAssignmentMaterials.assignmentId, params.assignmentId),
        eq(schoolAssignmentMaterials.source, "native_test"),
      ),
    );

  const rollupRows: Array<{
    autoScore: number | null;
    manualScore: number | null;
    needsManual: boolean;
  }> = [];

  for (const material of materials) {
    const pointsMode = (material.nativeTestPointsMode ?? "explicit") as SchoolNativeTestPointsMode;
    const questions = await db
      .select()
      .from(schoolTestQuestions)
      .where(eq(schoolTestQuestions.materialId, material.id))
      .orderBy(asc(schoolTestQuestions.sortOrder));
    const responses = await db
      .select()
      .from(schoolSubmissionResponses)
      .where(
        and(
          eq(schoolSubmissionResponses.submissionId, params.submissionId),
          eq(schoolSubmissionResponses.materialId, material.id),
          eq(schoolSubmissionResponses.turnInNumber, params.turnInNumber),
        ),
      );
    const byQuestion = new Map(responses.map((r) => [r.questionId, r]));
    const gradable = questions.map(toGradable);

    for (const question of questions) {
      const existing = byQuestion.get(question.id);
      const auto =
        existing?.autoScore ??
        scoreQuestion(
          toGradable(question),
          existing?.responseJson ?? null,
          pointsMode,
          assignmentRow.pointsPossible,
          gradable,
        ).autoScore;
      const manual = existing?.manualScore ?? null;
      const effective = effectiveQuestionScore({ autoScore: auto, manualScore: manual });
      const isLong = question.questionType === "long_answer";
      rollupRows.push({
        autoScore: auto,
        manualScore: manual,
        needsManual: isLong && effective == null,
      });
    }
  }

  const rollup = rollupTestScore(rollupRows);
  if (rollup.needsManualGrade) {
    const [existing] = await db
      .select()
      .from(schoolGrades)
      .where(eq(schoolGrades.submissionId, params.submissionId))
      .limit(1);
    if (existing) {
      await db
        .update(schoolGrades)
        .set({
          score: null,
          gradedByUserId: params.gradedByUserId,
          gradedAt: new Date(),
        })
        .where(eq(schoolGrades.id, existing.id));
    }
    await db
      .update(schoolSubmissions)
      .set({ status: "submitted", updatedAt: new Date() })
      .where(eq(schoolSubmissions.id, params.submissionId));
  } else {
    await upsertSubmissionGrade(db, {
      submissionId: params.submissionId,
      score: rollup.score,
      needsManualGrade: false,
      gradedByUserId: params.gradedByUserId,
    });
  }
  return rollup;
}

async function upsertSubmissionGrade(
  db: Database,
  params: {
    submissionId: string;
    score: number | null;
    needsManualGrade: boolean;
    gradedByUserId: string | null;
  },
) {
  if (params.needsManualGrade) {
    // Keep submitted; do not force a null grade row over teacher feedback.
    return;
  }
  if (params.score == null) return;

  const [existing] = await db
    .select()
    .from(schoolGrades)
    .where(eq(schoolGrades.submissionId, params.submissionId))
    .limit(1);
  const now = new Date();
  if (existing) {
    await db
      .update(schoolGrades)
      .set({
        score: params.score,
        gradedByUserId: params.gradedByUserId ?? existing.gradedByUserId,
        gradedAt: now,
      })
      .where(eq(schoolGrades.id, existing.id));
  } else {
    await db.insert(schoolGrades).values({
      submissionId: params.submissionId,
      score: params.score,
      feedbackHtml: "",
      revisionRequested: false,
      gradedByUserId: params.gradedByUserId,
      gradedAt: now,
    });
  }
  await db
    .update(schoolSubmissions)
    .set({ status: "graded", updatedAt: now })
    .where(eq(schoolSubmissions.id, params.submissionId));
}

export function reviewQuestionMaxPoints(
  question: GradableQuestion,
  pointsMode: SchoolNativeTestPointsMode,
  assignmentPointsPossible: number | null,
  allQuestions: GradableQuestion[],
): number {
  return questionMaxPoints(question, pointsMode, assignmentPointsPossible, allQuestions);
}
