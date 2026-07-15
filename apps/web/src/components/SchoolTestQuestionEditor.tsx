"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import {
  formatWeightPercent,
  isMcQuestionType,
  QUESTION_TYPE_LABELS,
  sumExplicitPoints,
  type SchoolNativeTestPointsMode,
  type SchoolQuestionType,
  type SchoolTestQuestionDto,
} from "../lib/school-test-questions";
import { Alert, Button, Checkbox, Input, Modal, Select, Textarea } from "./ui";
import { MarkdownContent } from "./ui/MarkdownContent";

function defaultOptions() {
  return [
    { id: "a", label: "Option A" },
    { id: "b", label: "Option B" },
  ];
}

function nextOptionId(options: Array<{ id: string }>): string {
  const used = new Set(options.map((o) => o.id));
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(97 + i);
    if (!used.has(id)) return id;
  }
  return `opt-${options.length + 1}`;
}

export function SchoolTestQuestionEditor({
  assignmentId,
  materialId,
  pointsMode,
  assignmentPointsPossible,
  frozen,
  onPointsModeChange,
}: {
  assignmentId: string;
  materialId: string;
  pointsMode: SchoolNativeTestPointsMode;
  assignmentPointsPossible: number | null;
  frozen: boolean;
  onPointsModeChange: (mode: SchoolNativeTestPointsMode) => Promise<void>;
}) {
  const [questions, setQuestions] = useState<SchoolTestQuestionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewQuestions, setPreviewQuestions] = useState<SchoolTestQuestionDto[]>([]);

  const loadQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<{ questions: SchoolTestQuestionDto[] }>(
        `/api/school/assignments/${assignmentId}/materials/${materialId}/questions`,
      );
      setQuestions(data.questions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load questions");
    } finally {
      setLoading(false);
    }
  }, [assignmentId, materialId]);

  useEffect(() => {
    void loadQuestions();
  }, [loadQuestions]);

  async function addQuestion() {
    setError(null);
    try {
      await apiClient.post(
        `/api/school/assignments/${assignmentId}/materials/${materialId}/questions`,
        {
          questionType: "multiple_choice",
          promptMarkdown: "New question",
          optionsJson: defaultOptions(),
          correctAnswerJson: { optionId: "a" },
          ...(pointsMode === "explicit" ? { points: 1 } : { weight: 1 }),
        },
      );
      await loadQuestions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add question");
    }
  }

  async function saveQuestion(question: SchoolTestQuestionDto) {
    setSavingId(question.id);
    setError(null);
    try {
      await apiClient.patch(
        `/api/school/assignments/${assignmentId}/materials/${materialId}/questions/${question.id}`,
        {
          questionType: question.questionType,
          promptMarkdown: question.promptMarkdown,
          sortOrder: question.sortOrder,
          points: question.points,
          weight: question.weight,
          optionsJson: question.optionsJson,
          correctAnswerJson: question.correctAnswerJson,
        },
      );
      await loadQuestions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save question");
    } finally {
      setSavingId(null);
    }
  }

  async function removeQuestion(questionId: string) {
    setError(null);
    try {
      await apiClient.delete(
        `/api/school/assignments/${assignmentId}/materials/${materialId}/questions/${questionId}`,
      );
      await loadQuestions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove question");
    }
  }

  async function moveQuestion(question: SchoolTestQuestionDto, direction: -1 | 1) {
    const index = questions.findIndex((q) => q.id === question.id);
    const swap = questions[index + direction];
    if (!swap) return;
    setError(null);
    try {
      await Promise.all([
        apiClient.patch(
          `/api/school/assignments/${assignmentId}/materials/${materialId}/questions/${question.id}`,
          { sortOrder: swap.sortOrder },
        ),
        apiClient.patch(
          `/api/school/assignments/${assignmentId}/materials/${materialId}/questions/${swap.id}`,
          { sortOrder: question.sortOrder },
        ),
      ]);
      await loadQuestions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reorder questions");
    }
  }

  async function openPreview() {
    setError(null);
    try {
      const data = await apiClient.get<{ questions: SchoolTestQuestionDto[] }>(
        `/api/school/assignments/${assignmentId}/materials/${materialId}/questions/preview`,
      );
      setPreviewQuestions(data.questions);
      setPreviewOpen(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load preview");
    }
  }

  function updateLocal(questionId: string, patch: Partial<SchoolTestQuestionDto>) {
    setQuestions((prev) =>
      prev.map((q) => (q.id === questionId ? { ...q, ...patch } : q)),
    );
  }

  const explicitTotal = sumExplicitPoints(questions);
  const weightTotal = questions.reduce((sum, q) => sum + (q.weight ?? 0), 0);
  const pointsMismatch =
    pointsMode === "explicit" &&
    assignmentPointsPossible != null &&
    questions.length > 0 &&
    Math.abs(explicitTotal - assignmentPointsPossible) > 0.01;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-medium">Questions</h3>
        <div className="flex flex-wrap gap-2">
          {!frozen ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => void addQuestion()}>
              Add question
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => void openPreview()}>
            Preview
          </Button>
        </div>
      </div>

      {!frozen ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            value={pointsMode}
            onChange={(e) =>
              void onPointsModeChange(e.target.value as SchoolNativeTestPointsMode)
            }
            aria-label="Points mode"
          >
            <option value="explicit">Explicit points per question</option>
            <option value="weighted">Weighted (% of assignment points)</option>
          </Select>
          <p className="text-xs text-[var(--color-text-muted)] self-center">
            {pointsMode === "weighted"
              ? assignmentPointsPossible != null
                ? `Assignment: ${assignmentPointsPossible} pts total`
                : "Set assignment points for weighted mode"
              : `Question total: ${explicitTotal} pts`}
          </p>
        </div>
      ) : null}

      {pointsMismatch ? (
        <Alert variant="info">
          Question points sum to {explicitTotal}; assignment is set to {assignmentPointsPossible}{" "}
          pts.
        </Alert>
      ) : null}

      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading questions…</p>
      ) : questions.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No questions yet.</p>
      ) : (
        <ul className="space-y-3">
          {questions.map((question, index) => (
            <li
              key={question.id}
              className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  Q{index + 1}
                </span>
                <Select
                  value={question.questionType}
                  disabled={frozen}
                  onChange={(e) => {
                    const questionType = e.target.value as SchoolQuestionType;
                    const patch: Partial<SchoolTestQuestionDto> = { questionType };
                    if (isMcQuestionType(questionType)) {
                      patch.optionsJson = question.optionsJson ?? defaultOptions();
                      patch.correctAnswerJson =
                        questionType === "multiple_choice_multi"
                          ? { optionIds: ["a"] }
                          : { optionId: "a" };
                    } else if (questionType === "true_false") {
                      patch.optionsJson = null;
                      patch.correctAnswerJson = { value: true };
                    } else if (questionType === "short_answer") {
                      patch.optionsJson = null;
                      patch.correctAnswerJson = { accepted: [""] };
                    } else {
                      patch.optionsJson = null;
                      patch.correctAnswerJson = null;
                    }
                    updateLocal(question.id, patch);
                  }}
                  aria-label="Question type"
                >
                  {(Object.keys(QUESTION_TYPE_LABELS) as SchoolQuestionType[]).map((type) => (
                    <option key={type} value={type}>
                      {QUESTION_TYPE_LABELS[type]}
                    </option>
                  ))}
                </Select>
                {pointsMode === "explicit" ? (
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    className="w-24"
                    disabled={frozen}
                    value={question.points ?? ""}
                    onChange={(e) =>
                      updateLocal(question.id, {
                        points: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    aria-label="Points"
                  />
                ) : (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {formatWeightPercent(question.weight, weightTotal)}
                    {assignmentPointsPossible != null
                      ? ` (~${(((question.weight ?? 0) / Math.max(weightTotal, 1)) * assignmentPointsPossible).toFixed(1)} pts)`
                      : null}
                  </span>
                )}
              </div>

              <Textarea
                value={question.promptMarkdown}
                disabled={frozen}
                onChange={(e) => updateLocal(question.id, { promptMarkdown: e.target.value })}
                placeholder="Question prompt (markdown)"
                className="min-h-[80px]"
                aria-label="Question prompt"
              />

              {isMcQuestionType(question.questionType) && question.optionsJson ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--color-text-muted)]">Options</p>
                  {question.optionsJson.map((opt) => (
                    <div key={opt.id} className="flex gap-2">
                      <Input
                        value={opt.label}
                        disabled={frozen}
                        onChange={(e) => {
                          const optionsJson = question.optionsJson!.map((o) =>
                            o.id === opt.id ? { ...o, label: e.target.value } : o,
                          );
                          updateLocal(question.id, { optionsJson });
                        }}
                        aria-label={`Option ${opt.id}`}
                      />
                      {!frozen && question.optionsJson!.length > 2 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const optionsJson = question.optionsJson!.filter((o) => o.id !== opt.id);
                            updateLocal(question.id, { optionsJson });
                          }}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {!frozen ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const id = nextOptionId(question.optionsJson!);
                        updateLocal(question.id, {
                          optionsJson: [...question.optionsJson!, { id, label: `Option ${id.toUpperCase()}` }],
                        });
                      }}
                    >
                      Add option
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {!frozen && question.questionType !== "long_answer" ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--color-text-muted)]">Correct answer</p>
                  {question.questionType === "multiple_choice" && question.optionsJson ? (
                    <Select
                      value={String((question.correctAnswerJson as { optionId?: string })?.optionId ?? "")}
                      onChange={(e) =>
                        updateLocal(question.id, { correctAnswerJson: { optionId: e.target.value } })
                      }
                      aria-label="Correct option"
                    >
                      {question.optionsJson.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  {question.questionType === "multiple_choice_multi" && question.optionsJson ? (
                    <div className="flex flex-col gap-1">
                      {question.optionsJson.map((opt) => {
                        const selected = (
                          (question.correctAnswerJson as { optionIds?: string[] })?.optionIds ?? []
                        ).includes(opt.id);
                        return (
                          <Checkbox
                            key={opt.id}
                            label={opt.label}
                            checked={selected}
                            onChange={(e) => {
                              const current = new Set(
                                (question.correctAnswerJson as { optionIds?: string[] })?.optionIds ?? [],
                              );
                              if (e.target.checked) current.add(opt.id);
                              else current.delete(opt.id);
                              updateLocal(question.id, {
                                correctAnswerJson: { optionIds: [...current] },
                              });
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                  {question.questionType === "true_false" ? (
                    <Select
                      value={String(
                        (question.correctAnswerJson as { value?: boolean })?.value ?? true,
                      )}
                      onChange={(e) =>
                        updateLocal(question.id, {
                          correctAnswerJson: { value: e.target.value === "true" },
                        })
                      }
                      aria-label="Correct true/false"
                    >
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </Select>
                  ) : null}
                  {question.questionType === "short_answer" ? (
                    <Input
                      value={(
                        (question.correctAnswerJson as { accepted?: string[] })?.accepted ?? [""]
                      ).join(", ")}
                      onChange={(e) =>
                        updateLocal(question.id, {
                          correctAnswerJson: {
                            accepted: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                      placeholder="Accepted answers, comma-separated"
                      aria-label="Accepted answers"
                    />
                  ) : null}
                </div>
              ) : null}

              {pointsMode === "weighted" && !frozen ? (
                <Input
                  type="number"
                  min={0}
                  step={1}
                  className="w-32"
                  value={question.weight ?? ""}
                  onChange={(e) =>
                    updateLocal(question.id, {
                      weight: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  aria-label="Weight"
                />
              ) : null}

              {!frozen ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    loading={savingId === question.id}
                    onClick={() => void saveQuestion(question)}
                  >
                    Save question
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => void moveQuestion(question, -1)}
                  >
                    Move up
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={index === questions.length - 1}
                    onClick={() => void moveQuestion(question, 1)}
                  >
                    Move down
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void removeQuestion(question.id)}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Student preview">
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          {previewQuestions.map((q, i) => (
            <div key={q.id} className="space-y-2 border-b border-[var(--color-border)] pb-4">
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Question {i + 1}</p>
              <MarkdownContent source={q.promptMarkdown} />
              {q.optionsJson?.map((opt) => (
                <p key={opt.id} className="text-sm">
                  ○ {opt.label}
                </p>
              ))}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
