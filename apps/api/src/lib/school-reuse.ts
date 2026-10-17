import type { Database } from "@domi-ops/db";
import { schoolAssignments, schoolAssignmentMaterials, schoolTestQuestions } from "@domi-ops/db";
import { asc, eq } from "drizzle-orm";

/** Copies teaching content only. Submissions, grades, frozen snapshots and histories stay put. */
export async function copyTeachingAssignment(db: Database, source: typeof schoolAssignments.$inferSelect, targetClassId: string, categoryId: string | null, userId: string) {
  const [copy] = await db.insert(schoolAssignments).values({
    classId: targetClassId, categoryId, title: source.title, instructionsHtml: source.instructionsHtml,
    dueAt: null, pointsPossible: source.pointsPossible, allowLate: source.allowLate, maxAttempts: source.maxAttempts,
    visibility: "draft", createdByUserId: userId,
  }).returning();
  const materials = await db.select().from(schoolAssignmentMaterials).where(eq(schoolAssignmentMaterials.assignmentId, source.id)).orderBy(asc(schoolAssignmentMaterials.sortOrder)).for("update");
  for (const m of materials) {
    const [material] = await db.insert(schoolAssignmentMaterials).values({
      assignmentId: copy.id, role: m.role, source: m.source, displayName: m.displayName, sortOrder: m.sortOrder,
      driveObjectId: m.driveObjectId, externalUrl: m.externalUrl, googleFileId: m.googleFileId, googleMimeType: m.googleMimeType,
      googleRevisionId: m.googleRevisionId, isTest: m.isTest, strictContentCheck: m.strictContentCheck,
      studentVisible: m.studentVisible, observerVisible: m.observerVisible, nativeTestPointsMode: m.nativeTestPointsMode,
      // Preserve the person who authorized the source material's class sharing.
      createdByUserId: m.createdByUserId,
    }).returning();
    if (m.source !== "native_test") continue;
    const questions = await db.select().from(schoolTestQuestions).where(eq(schoolTestQuestions.materialId, m.id)).orderBy(asc(schoolTestQuestions.sortOrder));
    if (questions.length) await db.insert(schoolTestQuestions).values(questions.map((q) => ({
      materialId: material.id, sortOrder: q.sortOrder, questionType: q.questionType, promptMarkdown: q.promptMarkdown,
      points: q.points, weight: q.weight, optionsJson: q.optionsJson, correctAnswerJson: q.correctAnswerJson,
    })));
  }
  return copy;
}
