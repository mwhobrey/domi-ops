"use client";

import { CheckCircle2, Circle, Upload } from "lucide-react";
import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { displayArtifactFileName } from "../lib/school-artifact-url";
import type { SchoolClassAccess } from "../lib/school-access";
import { SchoolSubmissionArtifacts } from "./SchoolSubmissionArtifacts";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, Textarea } from "./ui";
interface Submission {
  id: string;
  status: string;
  studentNote: string;
  submittedAt?: string | null;
  isLate?: boolean;
  artifacts: { id: string; artifactType: string; s3Key: string | null; url: string | null }[];
  grade: { score: number | null; feedbackHtml: string } | null;
}

const STATUS_TONE: Record<string, "default" | "accent" | "success" | "warning"> = {
  not_started: "default",
  submitted: "accent",
  graded: "success",
  returned: "warning",
};

const STUDENT_STATUS: Record<string, { label: string; tone: "default" | "accent" | "success" | "warning" }> = {
  not_started: { label: "To do", tone: "default" },
  submitted: { label: "Turned in", tone: "accent" },
  graded: { label: "Graded", tone: "success" },
  returned: { label: "Try again", tone: "warning" },
};

const TEACHER_WORKFLOW_STEPS = [
  { key: "submit", label: "Student turned in" },
  { key: "upload", label: "Files attached" },
  { key: "grade", label: "Graded" },
] as const;

function stepDone(
  key: (typeof TEACHER_WORKFLOW_STEPS)[number]["key"],
  submission: Submission | undefined,
): boolean {
  if (!submission) return false;
  if (key === "submit") return submission.status !== "not_started";
  if (key === "upload") return submission.artifacts.length > 0;
  if (key === "grade") return submission.grade?.score != null || submission.status === "graded";
  return false;
}

function formatDueLabel(dueAt: string, forStudent: boolean): string {
  const date = new Date(dueAt);
  if (forStudent) {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function mergeSubmissionResponse(existing: Submission | undefined, incoming: Submission): Submission {
  return {
    ...incoming,
    artifacts: incoming.artifacts?.length ? incoming.artifacts : (existing?.artifacts ?? []),
    grade: existing?.grade ?? incoming.grade ?? null,
    studentNote: incoming.studentNote ?? existing?.studentNote ?? "",
  };
}

export function SchoolAssignmentDetail({
  assignmentId,
  assignmentTitle,
  className,
  instructionsHtml,
  pointsPossible,
  dueAt,
  visibility,
  initialSubmissions,
  access,
}: {
  assignmentId: string;
  assignmentTitle: string;
  className: string;
  instructionsHtml?: string;
  pointsPossible?: number;
  dueAt?: string | null;
  visibility?: string;
  initialSubmissions: Submission[];
  access: SchoolClassAccess;
}) {
  const canSubmit = access.canSubmit;
  const canGrade = access.canGrade;
  const isStudent = access.viewMode === "student";
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [note, setNote] = useState(initialSubmissions[0]?.studentNote ?? "");
  const [score, setScore] = useState(() => {
    const existing = initialSubmissions[0]?.grade?.score;
    return existing != null ? String(existing) : "";
  });
  const [feedback, setFeedback] = useState(initialSubmissions[0]?.grade?.feedbackHtml ?? "");  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submission = submissions[0];
  const status = submission?.status ?? "not_started";
  const statusMeta = isStudent
    ? (STUDENT_STATUS[status] ?? { label: status.replace("_", " "), tone: "default" as const })
    : { label: status.replace("_", " "), tone: STATUS_TONE[status] ?? "default" };
  const turnedIn = status === "submitted" || status === "graded" || status === "returned";
  const dueLabel = dueAt ? formatDueLabel(dueAt, isStudent) : null;
  const isPastDue = Boolean(dueAt && new Date(dueAt) < new Date() && !turnedIn);
  const turnedInLate = Boolean(submission?.isLate);

  async function ensureSubmissionRecord(): Promise<Submission> {
    if (submission) return submission;
    const data = await apiClient.post<{ submission: Submission }>(
      `/api/school/assignments/${assignmentId}/submit`,
      { studentNote: note },
    );
    const merged = mergeSubmissionResponse(undefined, {
      ...data.submission,
      artifacts: data.submission.artifacts ?? [],
      grade: null,
    });
    setSubmissions([merged]);
    return merged;
  }

  async function submitWork() {
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiClient.post<{ submission: Submission }>(
        `/api/school/assignments/${assignmentId}/submit`,
        { studentNote: note },
      );
      setSubmissions((prev) => {
        const existing = prev.find((s) => s.id === data.submission.id);
        const rest = prev.filter((s) => s.id !== data.submission.id);
        return [...rest, mergeSubmissionResponse(existing, data.submission)];
      });
    } catch (err) {
      if (err instanceof ApiError && err.body?.includes("late_not_allowed")) {
        setError("This assignment is past due and no longer accepts new turn-ins.");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not turn in assignment. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadStatus(null);
    setUploadError(false);
    setError(null);
    const contentType = file.type?.trim() || "application/octet-stream";
    try {
      const activeSubmission = await ensureSubmissionRecord();
      setUploadStatus("Uploading your file…");
      const { uploadUrl, key } = await apiClient.post<{ uploadUrl: string; key: string }>(
        "/api/school/upload/presign",
        { filename: file.name, contentType },
      );
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType },
      });
      if (!put.ok) {
        throw new Error(`storage_put_${put.status}`);
      }
      const art = await apiClient.post<{
        artifact: { id: string; artifactType: string; s3Key: string | null; url: string | null };
      }>(`/api/school/submissions/${activeSubmission.id}/artifacts`, {
        artifactType: "file",
        s3Key: key,
      });
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === activeSubmission.id ? { ...s, artifacts: [...s.artifacts, art.artifact] } : s,
        ),
      );
      setUploadStatus(`${displayArtifactFileName(art.artifact)} uploaded`);    } catch (err) {
      setUploadStatus(null);
      setUploadError(true);
      if (err instanceof ApiError && err.body?.includes("s3_not_configured")) {
        setError("File uploads are not set up yet. Ask a parent to check storage settings.");
      } else if (err instanceof Error && err.message.startsWith("storage_put_")) {
        setError("Your file could not be saved. Try again in a moment.");
      } else {
        setError("Upload failed. Try choosing the file again.");
      }
    } finally {
      setUploading(false);
    }
  }

  async function saveGrade(submissionId: string) {
    setGrading(true);
    setError(null);
    try {
      const data = await apiClient.post<{ grade: { score: number | null; feedbackHtml: string } }>(
        `/api/school/submissions/${submissionId}/grade`,
        {
          score: score ? parseFloat(score) : null,
          feedbackHtml: feedback,
        },
      );
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === submissionId ? { ...s, status: "graded", grade: data.grade } : s,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Grade failed");
    } finally {
      setGrading(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        {!isStudent && visibility && <Badge tone="default">{visibility}</Badge>}
        {dueLabel && (
          <Badge tone={isPastDue ? "warning" : status === "not_started" ? "accent" : "default"}>
            {isStudent ? `Due ${dueLabel}` : `Due ${dueLabel}`}
          </Badge>
        )}
        {isPastDue && <Badge tone="warning">Overdue</Badge>}
        {turnedInLate && <Badge tone="warning">Late</Badge>}
        {pointsPossible != null && (
          <Badge tone="default">{isStudent ? `${pointsPossible} points` : `${pointsPossible} pts`}</Badge>
        )}
        <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
      </div>

      {isStudent && canSubmit && isPastDue && status === "not_started" && (
        <Alert variant="info">
          This assignment is past due. You can still turn it in — your teacher will see it as late.
        </Alert>
      )}

      {isStudent && canSubmit && turnedIn && status !== "graded" && status !== "returned" && (
        <Alert variant="success">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            You turned this in
            {submission?.submittedAt
              ? ` on ${new Date(submission.submittedAt).toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}`
              : ""}
            {turnedInLate ? " (late)" : ""}
            . You can still add files or update your message below.
          </span>
        </Alert>
      )}

      {instructionsHtml && (
        <Card>
          <CardHeader>
            <h2 className={isStudent ? "text-base font-semibold" : "font-medium"}>
              {isStudent ? "What to do" : "Instructions"}
            </h2>
          </CardHeader>
          <CardBody>
            <div
              className={
                isStudent
                  ? "text-base leading-relaxed whitespace-pre-wrap text-[var(--color-text)]"
                  : "prose prose-sm max-w-none whitespace-pre-wrap text-[var(--color-text)]"
              }
            >
              {instructionsHtml}
            </div>
          </CardBody>
        </Card>
      )}

      {canGrade && (
        <nav aria-label="Assignment workflow" className="flex flex-wrap gap-4">
          {TEACHER_WORKFLOW_STEPS.map((step, i) => {
            const done = stepDone(step.key, submission);
            return (
              <div key={step.key} className="flex items-center gap-2 text-sm">
                {done ? (
                  <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden />
                )}
                <span className={done ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}>
                  {i + 1}. {step.label}
                </span>
              </div>
            );
          })}
        </nav>
      )}

      {canSubmit && isStudent && (
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Your work</h2>
            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
          </CardHeader>
          <CardBody className="space-y-5">
            {status === "not_started" && (
              <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
                Add photos or files of your work, write a message if you need to, then tap{" "}
                <span className="font-medium text-[var(--color-text)]">Turn in assignment</span>.
              </p>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-medium">Your files</h3>
              <label
                className={
                  uploading
                    ? "flex cursor-wait flex-col items-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--color-accent)]/40 bg-[var(--color-accent-subtle)]/20 px-6 py-8 text-center"
                    : "flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--color-border)] px-6 py-8 text-center transition hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-surface-elevated)]"
                }
              >
                <Upload className="h-8 w-8 text-[var(--color-accent)]" aria-hidden />
                <span className="text-base font-medium">
                  {uploading ? "Uploading…" : "Tap to add a file"}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  Photos, PDFs, or documents
                </span>
                <input
                  type="file"
                  className="sr-only"
                  disabled={uploading}
                  accept="image/*,.pdf,.doc,.docx,.txt"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void uploadFile(f);
                  }}
                />
              </label>

              {submission && submission.artifacts.length > 0 && (
                <SchoolSubmissionArtifacts artifacts={submission.artifacts} />
              )}
              {uploadStatus && !uploadError && (
                <p className="text-xs text-[var(--color-success)]">{uploadStatus}</p>
              )}
              {uploadError && (
                <Alert variant="error">That file did not upload. Try again or pick a different file.</Alert>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="student-note" className="text-sm font-medium">
                Message for your teacher{" "}
                <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>
              </label>
              <Textarea
                id="student-note"
                placeholder="Example: I finished the worksheet. The last problem was tricky."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="text-base"
              />
            </div>

            <Button
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => void submitWork()}
              loading={submitting}
            >
              {status === "not_started" ? "Turn in assignment" : "Save changes"}
            </Button>
          </CardBody>
        </Card>
      )}

      {canGrade && submission && (
        <Card>
          <CardHeader>
            <h2 className="font-medium">Student work</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            {submission.submittedAt && (
              <p className="text-sm text-[var(--color-text-muted)]">
                Turned in{" "}
                {new Date(submission.submittedAt).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {submission.isLate ? (
                  <>
                    {" "}
                    <Badge tone="warning">Late</Badge>
                  </>
                ) : null}
              </p>
            )}
            {submission.studentNote?.trim() ? (
              <div className="space-y-1">
                <h3 className="text-sm font-medium">Student message</h3>
                <p className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                  {submission.studentNote}
                </p>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">No message from the student.</p>
            )}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Submitted files</h3>
              <SchoolSubmissionArtifacts artifacts={submission.artifacts} showPreview />
            </div>
          </CardBody>
        </Card>
      )}

      {isStudent && submission?.grade?.score != null && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">Your grade</h2>
          </CardHeader>
          <CardBody>
            <p className="text-2xl font-semibold tabular-nums">
              {submission.grade.score}
              {pointsPossible != null ? ` / ${pointsPossible}` : ""}
            </p>
            {submission.grade.feedbackHtml && (
              <div className="mt-3 space-y-1">
                <p className="text-sm font-medium">Teacher feedback</p>
                <p className="text-sm leading-relaxed text-[var(--color-text-muted)] whitespace-pre-wrap">
                  {submission.grade.feedbackHtml}
                </p>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {canGrade && submission && (
        <Card>
          <CardHeader>
            <h2 className="font-medium">Grade</h2>
          </CardHeader>
          <CardBody>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void saveGrade(submission.id);
              }}
            >
              <div className="flex flex-wrap gap-2">
                <Input
                  className="w-28"
                  type="number"
                  min={0}
                  max={pointsPossible ?? undefined}
                  step={0.5}
                  placeholder="Score"
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  aria-label="Score"
                />
                {pointsPossible != null && (
                  <span className="self-center text-sm text-[var(--color-text-muted)]">
                    / {pointsPossible}
                  </span>
                )}
              </div>
              <Textarea
                placeholder="Feedback (optional)"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                aria-label="Feedback"
              />
              <Button type="submit" variant="secondary" loading={grading}>
                Save grade
              </Button>
            </form>
            {submission.grade?.score != null && (
              <p className="mt-3 text-sm">
                Current score:{" "}
                <strong>
                  {submission.grade.score}
                  {pointsPossible != null ? ` / ${pointsPossible}` : ""}
                </strong>
              </p>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
