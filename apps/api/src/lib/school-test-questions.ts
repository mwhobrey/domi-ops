import type { schoolTestQuestions } from "@domi-ops/db";

export const SCHOOL_QUESTION_TYPES = [
  "multiple_choice",
  "multiple_choice_multi",
  "true_false",
  "short_answer",
  "long_answer",
] as const;

export type SchoolQuestionType = (typeof SCHOOL_QUESTION_TYPES)[number];

export const SCHOOL_NATIVE_TEST_POINTS_MODES = ["explicit", "weighted"] as const;

export type SchoolNativeTestPointsMode = (typeof SCHOOL_NATIVE_TEST_POINTS_MODES)[number];

export type McOption = { id: string; label: string };

export interface QuestionInput {
  questionType?: SchoolQuestionType;
  promptMarkdown?: string;
  sortOrder?: number;
  points?: number | null;
  weight?: number | null;
  optionsJson?: McOption[] | null;
  correctAnswerJson?: Record<string, unknown> | null;
}

export function defaultMcOptions(): McOption[] {
  return [
    { id: "a", label: "Option A" },
    { id: "b", label: "Option B" },
  ];
}

export function defaultCorrectAnswer(questionType: SchoolQuestionType): Record<string, unknown> | null {
  switch (questionType) {
    case "multiple_choice":
      return { optionId: "a" };
    case "multiple_choice_multi":
      return { optionIds: ["a"] };
    case "true_false":
      return { value: true };
    case "short_answer":
      return { accepted: [""] };
    case "long_answer":
      return null;
    default:
      return null;
  }
}

export function validateQuestionInput(
  body: QuestionInput,
  opts: { pointsMode: SchoolNativeTestPointsMode; isCreate?: boolean },
):
  | { ok: true; value: Required<Pick<QuestionInput, "questionType" | "promptMarkdown">> & QuestionInput }
  | { ok: false; error: string } {
  const questionType = body.questionType ?? "multiple_choice";
  if (!SCHOOL_QUESTION_TYPES.includes(questionType)) {
    return { ok: false, error: "invalid_question_type" };
  }

  const promptMarkdown = body.promptMarkdown ?? "";
  if (opts.isCreate && !promptMarkdown.trim()) {
    return { ok: false, error: "prompt_required" };
  }

  const optionsJson =
    questionType === "multiple_choice" || questionType === "multiple_choice_multi"
      ? (body.optionsJson ?? defaultMcOptions())
      : null;

  if (optionsJson) {
    if (optionsJson.length < 2) return { ok: false, error: "options_min_two" };
    const ids = new Set<string>();
    for (const opt of optionsJson) {
      if (!opt.id?.trim() || !opt.label?.trim()) return { ok: false, error: "invalid_option" };
      if (ids.has(opt.id)) return { ok: false, error: "duplicate_option_id" };
      ids.add(opt.id);
    }
  }

  let correctAnswerJson = body.correctAnswerJson ?? defaultCorrectAnswer(questionType);
  if (questionType !== "long_answer") {
    const answerCheck = validateCorrectAnswer(questionType, correctAnswerJson, optionsJson);
    if (!answerCheck.ok) return answerCheck;
    correctAnswerJson = answerCheck.value;
  } else {
    correctAnswerJson = null;
  }

  if (opts.pointsMode === "explicit") {
    const points = body.points ?? 1;
    if (points <= 0) return { ok: false, error: "invalid_points" };
    return {
      ok: true,
      value: { ...body, questionType, promptMarkdown, points, weight: null, optionsJson, correctAnswerJson },
    };
  }

  const weight = body.weight ?? 1;
  if (weight <= 0) return { ok: false, error: "invalid_weight" };
  return {
    ok: true,
    value: { ...body, questionType, promptMarkdown, points: null, weight, optionsJson, correctAnswerJson },
  };
}

function validateCorrectAnswer(
  questionType: SchoolQuestionType,
  answer: Record<string, unknown> | null,
  options: McOption[] | null,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!answer) return { ok: false, error: "correct_answer_required" };
  const optionIds = new Set((options ?? []).map((o) => o.id));

  if (questionType === "multiple_choice") {
    const optionId = answer.optionId;
    if (typeof optionId !== "string" || !optionIds.has(optionId)) {
      return { ok: false, error: "invalid_correct_answer" };
    }
    return { ok: true, value: { optionId } };
  }

  if (questionType === "multiple_choice_multi") {
    const optionIdsAnswer = answer.optionIds;
    if (!Array.isArray(optionIdsAnswer) || optionIdsAnswer.length === 0) {
      return { ok: false, error: "invalid_correct_answer" };
    }
    for (const id of optionIdsAnswer) {
      if (typeof id !== "string" || !optionIds.has(id)) {
        return { ok: false, error: "invalid_correct_answer" };
      }
    }
    return { ok: true, value: { optionIds: [...optionIdsAnswer] } };
  }

  if (questionType === "true_false") {
    if (typeof answer.value !== "boolean") return { ok: false, error: "invalid_correct_answer" };
    return { ok: true, value: { value: answer.value } };
  }

  if (questionType === "short_answer") {
    const accepted = Array.isArray(answer.accepted)
      ? answer.accepted.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : typeof answer.text === "string" && answer.text.trim()
        ? [answer.text.trim()]
        : [];
    if (accepted.length === 0) return { ok: false, error: "invalid_correct_answer" };
    return { ok: true, value: { accepted } };
  }

  return { ok: false, error: "invalid_correct_answer" };
}

export function serializeQuestionStaff(row: typeof schoolTestQuestions.$inferSelect) {
  return {
    id: row.id,
    materialId: row.materialId,
    sortOrder: row.sortOrder,
    questionType: row.questionType,
    promptMarkdown: row.promptMarkdown,
    points: row.points,
    weight: row.weight,
    optionsJson: row.optionsJson,
    correctAnswerJson: row.correctAnswerJson,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeQuestionPreview(row: typeof schoolTestQuestions.$inferSelect) {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    questionType: row.questionType,
    promptMarkdown: row.promptMarkdown,
    points: row.points,
    weight: row.weight,
    optionsJson: row.optionsJson,
  };
}

export function sumExplicitPoints(
  questions: Array<{ points: number | null }>,
): number {
  return questions.reduce((sum, q) => sum + (q.points ?? 0), 0);
}

export function weightPercentages(
  questions: Array<{ weight: number | null }>,
): Array<number> {
  const total = questions.reduce((sum, q) => sum + (q.weight ?? 0), 0);
  if (total <= 0) return questions.map(() => 0);
  return questions.map((q) => ((q.weight ?? 0) / total) * 100);
}
