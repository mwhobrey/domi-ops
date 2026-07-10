export type SchoolQuestionType =
  | "multiple_choice"
  | "multiple_choice_multi"
  | "true_false"
  | "short_answer"
  | "long_answer";

export type SchoolNativeTestPointsMode = "explicit" | "weighted";

export interface SchoolTestQuestionDto {
  id: string;
  materialId: string;
  sortOrder: number;
  questionType: SchoolQuestionType;
  promptMarkdown: string;
  points: number | null;
  weight: number | null;
  optionsJson: Array<{ id: string; label: string }> | null;
  correctAnswerJson: Record<string, unknown> | null;
}

export const QUESTION_TYPE_LABELS: Record<SchoolQuestionType, string> = {
  multiple_choice: "Multiple choice",
  multiple_choice_multi: "Multiple choice (multi)",
  true_false: "True / false",
  short_answer: "Short answer",
  long_answer: "Long answer",
};

export function isMcQuestionType(type: SchoolQuestionType): boolean {
  return type === "multiple_choice" || type === "multiple_choice_multi";
}

export function sumExplicitPoints(questions: Array<{ points: number | null }>): number {
  return questions.reduce((sum, q) => sum + (q.points ?? 0), 0);
}

export function formatWeightPercent(weight: number | null, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round(((weight ?? 0) / total) * 100)}%`;
}
