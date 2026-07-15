import { normalizeTextForHash } from "./school-material-freeze.js";
import type { SchoolNativeTestPointsMode, SchoolQuestionType } from "./school-test-questions.js";

export type GradableQuestion = {
  id: string;
  questionType: SchoolQuestionType;
  points: number | null;
  weight: number | null;
  correctAnswerJson: Record<string, unknown> | null;
};

export type QuestionGradeResult = {
  questionId: string;
  autoScore: number | null;
  correct: boolean | null;
  needsManualGrade: boolean;
};

/** Case-insensitive short-answer compare after newline normalize + trim. */
export function normalizeShortAnswer(text: string): string {
  return normalizeTextForHash(text).toLowerCase();
}

export function scoreQuestion(
  question: GradableQuestion,
  responseJson: Record<string, unknown> | null | undefined,
  pointsMode: SchoolNativeTestPointsMode,
  assignmentPointsPossible: number | null,
  allQuestions: GradableQuestion[],
): QuestionGradeResult {
  const maxPoints = questionMaxPoints(question, pointsMode, assignmentPointsPossible, allQuestions);

  if (question.questionType === "long_answer") {
    return {
      questionId: question.id,
      autoScore: null,
      correct: null,
      needsManualGrade: true,
    };
  }

  const answered = hasAnswer(question.questionType, responseJson);
  if (!answered) {
    return {
      questionId: question.id,
      autoScore: 0,
      correct: false,
      needsManualGrade: false,
    };
  }

  const correct = isCorrect(question, responseJson!);
  return {
    questionId: question.id,
    autoScore: correct ? maxPoints : 0,
    correct,
    needsManualGrade: false,
  };
}

export function questionMaxPoints(
  question: GradableQuestion,
  pointsMode: SchoolNativeTestPointsMode,
  assignmentPointsPossible: number | null,
  allQuestions: GradableQuestion[],
): number {
  if (pointsMode === "weighted") {
    const totalWeight = allQuestions.reduce((sum, q) => sum + (q.weight ?? 0), 0);
    const assignmentPts = assignmentPointsPossible ?? 0;
    if (totalWeight <= 0 || assignmentPts <= 0) return 0;
    return ((question.weight ?? 0) / totalWeight) * assignmentPts;
  }
  return question.points ?? 1;
}

export function effectiveQuestionScore(params: {
  autoScore: number | null;
  manualScore: number | null;
}): number | null {
  if (params.manualScore != null) return params.manualScore;
  return params.autoScore;
}

export function rollupTestScore(
  rows: Array<{ autoScore: number | null; manualScore: number | null; needsManual: boolean }>,
): { score: number | null; needsManualGrade: boolean } {
  let needsManualGrade = false;
  let total = 0;
  for (const row of rows) {
    const effective = effectiveQuestionScore(row);
    if (effective == null) {
      needsManualGrade = true;
      continue;
    }
    total += effective;
  }
  if (needsManualGrade) return { score: null, needsManualGrade: true };
  return { score: Math.round(total * 1000) / 1000, needsManualGrade: false };
}

function hasAnswer(
  questionType: SchoolQuestionType,
  responseJson: Record<string, unknown> | null | undefined,
): boolean {
  if (!responseJson) return false;
  if (questionType === "multiple_choice") {
    return typeof responseJson.optionId === "string" && responseJson.optionId.length > 0;
  }
  if (questionType === "multiple_choice_multi") {
    return Array.isArray(responseJson.optionIds) && responseJson.optionIds.length > 0;
  }
  if (questionType === "true_false") {
    return typeof responseJson.value === "boolean";
  }
  if (questionType === "short_answer" || questionType === "long_answer") {
    return typeof responseJson.text === "string" && responseJson.text.trim().length > 0;
  }
  return false;
}

function isCorrect(
  question: GradableQuestion,
  responseJson: Record<string, unknown>,
): boolean {
  const correct = question.correctAnswerJson;
  if (!correct) return false;

  if (question.questionType === "multiple_choice") {
    return responseJson.optionId === correct.optionId;
  }

  if (question.questionType === "multiple_choice_multi") {
    const expected = Array.isArray(correct.optionIds)
      ? correct.optionIds.filter((v): v is string => typeof v === "string")
      : [];
    const actual = Array.isArray(responseJson.optionIds)
      ? responseJson.optionIds.filter((v): v is string => typeof v === "string")
      : [];
    if (expected.length !== actual.length) return false;
    const expectedSet = new Set(expected);
    return actual.every((id) => expectedSet.has(id));
  }

  if (question.questionType === "true_false") {
    return responseJson.value === correct.value;
  }

  if (question.questionType === "short_answer") {
    const text = typeof responseJson.text === "string" ? responseJson.text : "";
    const normalized = normalizeShortAnswer(text);
    const accepted = Array.isArray(correct.accepted)
      ? correct.accepted.filter((v): v is string => typeof v === "string")
      : typeof correct.text === "string"
        ? [correct.text]
        : [];
    return accepted.some((a) => normalizeShortAnswer(a) === normalized);
  }

  return false;
}
