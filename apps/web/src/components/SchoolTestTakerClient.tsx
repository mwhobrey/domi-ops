"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiClient } from "../lib/client-api";
import type { SchoolTestQuestionDto } from "../lib/school-test-questions";
import { Alert, Button, Checkbox, Input, Textarea } from "./ui";
import { MarkdownContent } from "./ui/MarkdownContent";

type StudentQuestion = Omit<SchoolTestQuestionDto, "materialId" | "correctAnswerJson">;

function isAnswered(question: StudentQuestion, response: Record<string, unknown> | undefined): boolean {
  if (!response) return false;
  if (question.questionType === "multiple_choice") {
    return typeof response.optionId === "string" && response.optionId.length > 0;
  }
  if (question.questionType === "multiple_choice_multi") {
    return Array.isArray(response.optionIds) && response.optionIds.length > 0;
  }
  if (question.questionType === "true_false") {
    return typeof response.value === "boolean";
  }
  if (question.questionType === "short_answer" || question.questionType === "long_answer") {
    return typeof response.text === "string" && response.text.trim().length > 0;
  }
  return false;
}

export function SchoolTestTakerClient({
  assignmentId,
  materialId,
  assignmentTitle,
  classId,
  className,
}: {
  assignmentId: string;
  materialId: string;
  assignmentTitle: string;
  classId: string;
  className: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("In-app test");
  const [questions, setQuestions] = useState<StudentQuestion[]>([]);
  const [responses, setResponses] = useState<Record<string, Record<string, unknown>>>({});
  const [canSubmit, setCanSubmit] = useState(false);
  const [draftLocked, setDraftLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [unansweredWarn, setUnansweredWarn] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const test = await apiClient.get<{
        material: { displayName: string };
        questions: StudentQuestion[];
        canSubmit: boolean;
        draftLocked: boolean;
      }>(`/api/school/assignments/${assignmentId}/materials/${materialId}/test`);
      setDisplayName(test.material.displayName);
      setQuestions(test.questions);
      setCanSubmit(test.canSubmit);
      setDraftLocked(test.draftLocked);

      if (test.canSubmit) {
        const draft = await apiClient.get<{
          responses: Array<{ questionId: string; responseJson: Record<string, unknown> }>;
        }>(`/api/school/assignments/${assignmentId}/materials/${materialId}/test-responses`);
        const map: Record<string, Record<string, unknown>> = {};
        for (const row of draft.responses) {
          map[row.questionId] = row.responseJson ?? {};
        }
        setResponses(map);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load test");
    } finally {
      setLoading(false);
    }
  }, [assignmentId, materialId]);

  useEffect(() => {
    void load();
  }, [load]);

  function setResponse(questionId: string, patch: Record<string, unknown>) {
    setResponses((prev) => ({
      ...prev,
      [questionId]: { ...(prev[questionId] ?? {}), ...patch },
    }));
    setInfo(null);
    setUnansweredWarn(false);
  }

  async function saveDraft() {
    if (!canSubmit || draftLocked) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      await apiClient.patch(
        `/api/school/assignments/${assignmentId}/materials/${materialId}/test-responses`,
        {
          responses: questions.map((q) => ({
            questionId: q.id,
            responseJson: responses[q.id] ?? {},
          })),
        },
      );
      setInfo("Progress saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save progress");
    } finally {
      setSaving(false);
    }
  }

  async function turnIn(force = false) {
    if (!canSubmit || draftLocked) return;
    const unanswered = questions.filter((q) => !isAnswered(q, responses[q.id]));
    if (unanswered.length > 0 && !force) {
      setUnansweredWarn(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.patch(
        `/api/school/assignments/${assignmentId}/materials/${materialId}/test-responses`,
        {
          responses: questions.map((q) => ({
            questionId: q.id,
            responseJson: responses[q.id] ?? {},
          })),
        },
      );
      await apiClient.post(`/api/school/assignments/${assignmentId}/submit`, {});
      router.push(`/school/assignment/${assignmentId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not turn in test");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading test…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <p className="text-xs text-[var(--color-text-muted)]">
          <Link href={`/school/class/${classId}`} className="underline-offset-2 hover:underline">
            {className}
          </Link>
          {" · "}
          <Link
            href={`/school/assignment/${assignmentId}`}
            className="underline-offset-2 hover:underline"
          >
            {assignmentTitle}
          </Link>
        </p>
        <h2 className="font-display text-2xl font-semibold tracking-tight">{displayName}</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Answer the questions below. You can save progress and come back later.
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {info ? <Alert variant="info">{info}</Alert> : null}
      {draftLocked ? (
        <Alert variant="info">You have used all allowed attempts for this assignment.</Alert>
      ) : null}

      {questions.length === 0 ? (
        <Alert variant="info">This test has no questions yet. Ask your teacher to add some.</Alert>
      ) : (
        <ol className="space-y-5">
          {questions.map((question, index) => {
            const response = responses[question.id] ?? {};
            return (
              <li
                key={question.id}
                className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-medium text-[var(--color-text-muted)]">
                    Question {index + 1}
                  </p>
                  {question.points != null ? (
                    <p className="text-xs text-[var(--color-text-muted)]">{question.points} pts</p>
                  ) : null}
                </div>
                <MarkdownContent source={question.promptMarkdown} />

                {question.questionType === "multiple_choice" && question.optionsJson ? (
                  <div className="flex flex-col gap-2">
                    {question.optionsJson.map((opt) => (
                      <label key={opt.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`q-${question.id}`}
                          disabled={!canSubmit}
                          checked={response.optionId === opt.id}
                          onChange={() => setResponse(question.id, { optionId: opt.id })}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                ) : null}

                {question.questionType === "multiple_choice_multi" && question.optionsJson ? (
                  <div className="flex flex-col gap-2">
                    {question.optionsJson.map((opt) => {
                      const selected = (
                        (response.optionIds as string[] | undefined) ?? []
                      ).includes(opt.id);
                      return (
                        <Checkbox
                          key={opt.id}
                          label={opt.label}
                          disabled={!canSubmit}
                          checked={selected}
                          onChange={(e) => {
                            const current = new Set(
                              (response.optionIds as string[] | undefined) ?? [],
                            );
                            if (e.target.checked) current.add(opt.id);
                            else current.delete(opt.id);
                            setResponse(question.id, { optionIds: [...current] });
                          }}
                        />
                      );
                    })}
                  </div>
                ) : null}

                {question.questionType === "true_false" ? (
                  <div className="flex flex-col gap-2">
                    {[true, false].map((value) => (
                      <label key={String(value)} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`q-${question.id}`}
                          disabled={!canSubmit}
                          checked={response.value === value}
                          onChange={() => setResponse(question.id, { value })}
                        />
                        {value ? "True" : "False"}
                      </label>
                    ))}
                  </div>
                ) : null}

                {question.questionType === "short_answer" ? (
                  <Input
                    value={typeof response.text === "string" ? response.text : ""}
                    disabled={!canSubmit}
                    onChange={(e) => setResponse(question.id, { text: e.target.value })}
                    placeholder="Your answer"
                    aria-label={`Answer for question ${index + 1}`}
                  />
                ) : null}

                {question.questionType === "long_answer" ? (
                  <Textarea
                    value={typeof response.text === "string" ? response.text : ""}
                    disabled={!canSubmit}
                    onChange={(e) => setResponse(question.id, { text: e.target.value })}
                    placeholder="Your answer"
                    className="min-h-[120px]"
                    aria-label={`Answer for question ${index + 1}`}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {unansweredWarn ? (
        <Alert variant="info">
          Some questions are still blank. You can turn in anyway — unanswered scored questions count
          as 0.
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" loading={submitting} onClick={() => void turnIn(true)}>
              Turn in anyway
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setUnansweredWarn(false)}>
              Keep working
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
        {canSubmit ? (
          <>
            <Button type="button" variant="secondary" loading={saving} onClick={() => void saveDraft()}>
              Save progress
            </Button>
            <Button type="button" loading={submitting} onClick={() => void turnIn(false)}>
              Turn in test
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(`/school/assignment/${assignmentId}`)}
        >
          Back to assignment
        </Button>
      </div>
    </div>
  );
}
