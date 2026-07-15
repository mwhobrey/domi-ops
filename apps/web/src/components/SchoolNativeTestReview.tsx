"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Badge, Button, Input } from "./ui";

type QuestionReview = {
  question: {
    id: string;
    sortOrder: number;
    questionType: string;
    promptMarkdown: string;
    optionsJson: Array<{ id: string; label: string }> | null;
    correctAnswerJson: Record<string, unknown> | null;
  };
  maxPoints: number;
  responseJson: Record<string, unknown>;
  autoScore: number | null;
  manualScore: number | null;
  effectiveScore: number | null;
  needsManualGrade: boolean;
};

type TestReviewPayload = {
  submission: {
    id: string;
    studentLabel: string;
    turnInCount: number;
  };
  turnInNumber: number;
  needsManualGrade: boolean;
  pendingManualCount: number;
  earnedTotal: number;
  maxTotal: number;
  grade: { score: number | null; feedbackHtml: string } | null;
  materials: Array<{
    materialId: string;
    displayName: string;
    pointsMode: string;
    questions: QuestionReview[];
  }>;
};

function formatAnswer(
  questionType: string,
  responseJson: Record<string, unknown>,
  options: Array<{ id: string; label: string }> | null,
): string {
  if (questionType === "multiple_choice") {
    const id = typeof responseJson.optionId === "string" ? responseJson.optionId : null;
    if (!id) return "(no answer)";
    return options?.find((o) => o.id === id)?.label ?? id;
  }
  if (questionType === "multiple_choice_multi") {
    const ids = Array.isArray(responseJson.optionIds)
      ? responseJson.optionIds.filter((v): v is string => typeof v === "string")
      : [];
    if (ids.length === 0) return "(no answer)";
    return ids.map((id) => options?.find((o) => o.id === id)?.label ?? id).join(", ");
  }
  if (questionType === "true_false") {
    if (typeof responseJson.value !== "boolean") return "(no answer)";
    return responseJson.value ? "True" : "False";
  }
  if (questionType === "short_answer" || questionType === "long_answer") {
    const text = typeof responseJson.text === "string" ? responseJson.text.trim() : "";
    return text || "(no answer)";
  }
  return "(no answer)";
}

function formatCorrect(question: QuestionReview["question"]): string {
  const key = question.correctAnswerJson;
  if (!key) return "—";
  const options = question.optionsJson;
  if (question.questionType === "multiple_choice") {
    const id = typeof key.optionId === "string" ? key.optionId : null;
    return id ? (options?.find((o) => o.id === id)?.label ?? id) : "—";
  }
  if (question.questionType === "multiple_choice_multi") {
    const ids = Array.isArray(key.optionIds)
      ? key.optionIds.filter((v): v is string => typeof v === "string")
      : [];
    return ids.map((id) => options?.find((o) => o.id === id)?.label ?? id).join(", ") || "—";
  }
  if (question.questionType === "true_false") {
    return key.value === true ? "True" : key.value === false ? "False" : "—";
  }
  if (question.questionType === "short_answer") {
    const accepted = Array.isArray(key.accepted)
      ? key.accepted.filter((v): v is string => typeof v === "string")
      : typeof key.text === "string"
        ? [key.text]
        : [];
    return accepted.join(" / ") || "—";
  }
  return "Manual";
}

export function SchoolNativeTestReview({
  submissionId,
  onRollupChange,
}: {
  submissionId: string;
  onRollupChange?: (grade: { score: number | null; feedbackHtml: string } | null) => void;
}) {
  const [review, setReview] = useState<TestReviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftScores, setDraftScores] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const onRollupChangeRef = useRef(onRollupChange);
  onRollupChangeRef.current = onRollupChange;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<TestReviewPayload>(
        `/api/school/submissions/${submissionId}/test-review`,
      );
      setReview(data);
      const drafts: Record<string, string> = {};
      for (const material of data.materials) {
        for (const q of material.questions) {
          if (q.manualScore != null) drafts[q.question.id] = String(q.manualScore);
          else if (q.needsManualGrade) drafts[q.question.id] = "";
          else if (q.autoScore != null) drafts[q.question.id] = String(q.autoScore);
        }
      }
      setDraftScores(drafts);
      onRollupChangeRef.current?.(data.grade);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load test review");
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveQuestionScore(questionId: string, maxPoints: number) {
    const raw = draftScores[questionId]?.trim() ?? "";
    if (raw === "") {
      setError("Enter a score before saving");
      return;
    }
    const value = Number(raw);
    if (Number.isNaN(value) || value < 0) {
      setError("Score must be a non-negative number");
      return;
    }
    if (value > maxPoints) {
      setError(`Score cannot exceed ${maxPoints}`);
      return;
    }
    setSavingId(questionId);
    setError(null);
    try {
      await apiClient.post(`/api/school/submissions/${submissionId}/grade-question`, {
        questionId,
        manualScore: value,
        turnInNumber: review?.turnInNumber,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save question score");
    } finally {
      setSavingId(null);
    }
  }

  if (loading && !review) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading test answers…</p>;
  }
  if (error && !review) {
    return <Alert variant="error">{error}</Alert>;
  }
  if (!review || review.materials.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">In-app test review</h3>
        {review.needsManualGrade ? (
          <Badge tone="warning">
            {review.pendingManualCount} need{review.pendingManualCount === 1 ? "s" : ""} manual grade
          </Badge>
        ) : (
          <Badge tone="success">Auto-graded</Badge>
        )}
        <span className="text-sm text-[var(--color-text-muted)] tabular-nums">
          {review.earnedTotal} / {review.maxTotal}
          {review.grade?.score != null ? ` · grade ${review.grade.score}` : ""}
        </span>
      </div>
      {error ? <Alert variant="error">{error}</Alert> : null}

      {review.materials.map((material) => (
        <div key={material.materialId} className="space-y-3">
          <p className="text-sm font-medium">{material.displayName}</p>
          <ul className="space-y-3">
            {material.questions.map((q, index) => {
              const answer = formatAnswer(
                q.question.questionType,
                q.responseJson,
                q.question.optionsJson,
              );
              const correct = formatCorrect(q.question);
              const isOverride = q.manualScore != null;
              return (
                <li
                  key={q.question.id}
                  className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium">
                        Q{index + 1}{" "}
                        <span className="font-normal text-[var(--color-text-muted)]">
                          ({q.question.questionType.replaceAll("_", " ")})
                        </span>
                      </p>
                      <p className="text-sm whitespace-pre-wrap">{q.question.promptMarkdown}</p>
                      <p className="text-sm">
                        <span className="text-[var(--color-text-muted)]">Answer: </span>
                        {answer}
                      </p>
                      <p className="text-sm">
                        <span className="text-[var(--color-text-muted)]">Key: </span>
                        {correct}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {q.needsManualGrade ? (
                        <Badge tone="warning">Needs score</Badge>
                      ) : q.effectiveScore === q.maxPoints ? (
                        <Badge tone="success">Correct</Badge>
                      ) : q.effectiveScore === 0 ? (
                        <Badge tone="default">Incorrect</Badge>
                      ) : (
                        <Badge tone="accent">Partial</Badge>
                      )}
                      <div className="flex items-center gap-2">
                        <Input
                          className="w-20"
                          type="number"
                          min={0}
                          max={q.maxPoints}
                          step={0.5}
                          value={draftScores[q.question.id] ?? ""}
                          onChange={(e) =>
                            setDraftScores((prev) => ({
                              ...prev,
                              [q.question.id]: e.target.value,
                            }))
                          }
                          aria-label={`Score for question ${index + 1}`}
                        />
                        <span className="text-sm text-[var(--color-text-muted)]">
                          / {q.maxPoints}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          loading={savingId === q.question.id}
                          onClick={() => void saveQuestionScore(q.question.id, q.maxPoints)}
                        >
                          {q.needsManualGrade ? "Save" : isOverride ? "Update" : "Override"}
                        </Button>
                      </div>
                      {q.autoScore != null && isOverride ? (
                        <p className="text-xs text-[var(--color-text-muted)]">
                          Auto was {q.autoScore}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
