"use client";

import { CheckCircle2, Circle, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import type { SchoolClassAccess } from "../lib/school-access";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, Textarea } from "./ui";

interface Submission {
  id: string;
  status: string;
  studentNote: string;
  submittedAt?: string | null;
  artifacts: { id: string; artifactType: string; s3Key: string | null; url: string | null }[];
  grade: { score: number | null; feedbackHtml: string } | null;
}

const STATUS_TONE: Record<string, "default" | "accent" | "success" | "warning"> = {
  not_started: "default",
  submitted: "accent",
  graded: "success",
  returned: "warning",
};

const WORKFLOW_STEPS = [
  { key: "submit", label: "Submit work" },
  { key: "upload", label: "Upload files" },
  { key: "grade", label: "Grade" },
] as const;

function stepDone(key: (typeof WORKFLOW_STEPS)[number]["key"], submission: Submission | undefined): boolean {
  if (!submission) return false;
  if (key === "submit") return submission.status !== "not_started";
  if (key === "upload") return submission.artifacts.length > 0;
  if (key === "grade") return submission.grade?.score != null || submission.status === "graded";
  return false;
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
  const [note, setNote] = useState("");
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submission = submissions[0];
  const status = submission?.status ?? "not_started";
  const statusTone = STATUS_TONE[status] ?? "default";

  async function submitWork() {
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiClient.post<{ submission: Submission }>(
        `/api/school/assignments/${assignmentId}/submit`,
        { studentNote: note },
      );
      setSubmissions((prev) => {
        const rest = prev.filter((s) => s.id !== data.submission.id);
        return [...rest, { ...data.submission, artifacts: data.submission.artifacts ?? [], grade: null }];
      });
      setNote("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadFile(file: File, submissionId: string) {
    setUploadStatus("Presigning…");
    setUploadError(false);
    try {
      const { uploadUrl, key } = await apiClient.post<{ uploadUrl: string; key: string }>(
        "/api/school/upload/presign",
        { filename: file.name, contentType: file.type },
      );
      setUploadStatus("Uploading…");
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) throw new Error("upload failed");
      const art = await apiClient.post<{
        artifact: { id: string; artifactType: string; s3Key: string | null; url: string | null };
      }>(`/api/school/submissions/${submissionId}/artifacts`, {
        artifactType: "file",
        s3Key: key,
      });
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === submissionId
            ? { ...s, artifacts: [...s.artifacts, art.artifact] }
            : s,
        ),
      );
      setUploadStatus("Uploaded");
    } catch {
      setUploadStatus("Upload failed");
      setUploadError(true);
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
          s.id === submissionId
            ? { ...s, status: "graded", grade: data.grade }
            : s,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Grade failed");
    } finally {
      setGrading(false);
    }
  }

  const dueLabel =
    dueAt &&
    new Date(dueAt).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        {visibility && <Badge tone="default">{visibility}</Badge>}
        {dueLabel && <Badge tone="accent">Due {dueLabel}</Badge>}
        {pointsPossible != null && <Badge tone="default">{pointsPossible} pts</Badge>}
        <Badge tone={statusTone}>{status.replace("_", " ")}</Badge>
      </div>

      {instructionsHtml && (
        <Card>
          <CardHeader>
            <h2 className="font-medium">Instructions</h2>
          </CardHeader>
          <CardBody>
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-[var(--color-text)]">
              {instructionsHtml}
            </div>
          </CardBody>
        </Card>
      )}

      {(canSubmit || canGrade) && (
      <nav aria-label="Assignment workflow" className="flex flex-wrap gap-4">
        {WORKFLOW_STEPS.filter((step) => {
          if (step.key === "grade") return canGrade;
          return canSubmit || canGrade;
        }).map((step, i) => {
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

      {canSubmit && (
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="font-medium">{isStudent ? "Your submission" : "Submit work"}</h2>
          {submission && <Badge tone={STATUS_TONE[submission.status] ?? "default"}>{submission.status}</Badge>}
        </CardHeader>
        <CardBody>
          <Textarea
            placeholder="Student note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Student note"
          />
          <Button className="mt-3" onClick={() => void submitWork()} loading={submitting}>
            {submission?.status === "not_started" ? "Submit assignment" : "Update submission"}
          </Button>
        </CardBody>
      </Card>
      )}

      {canSubmit && submission && (
        <Card>
          <CardHeader>
            <h2 className="font-medium">Upload artifact</h2>
          </CardHeader>
          <CardBody>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-4 py-3 text-sm hover:border-[var(--color-accent)]/50">
              <Upload className="h-4 w-4" aria-hidden />
              Choose file
              <input
                type="file"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadFile(f, submission.id);
                }}
              />
            </label>
            {submission.artifacts.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-[var(--color-text-muted)]" aria-label="Uploaded files">
                {submission.artifacts.map((a) => (
                  <li key={a.id}>{a.s3Key?.split("/").pop() ?? a.url ?? "File"}</li>
                ))}
              </ul>
            )}
            {uploadStatus && (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">{uploadStatus}</p>
            )}
            {uploadError && <Alert variant="error">Upload failed — check presign / MinIO.</Alert>}
          </CardBody>
        </Card>
      )}

      {isStudent && submission?.grade?.score != null && (
        <Card>
          <CardHeader>
            <h2 className="font-medium">Your grade</h2>
          </CardHeader>
          <CardBody>
            <p className="text-lg font-semibold tabular-nums">
              {submission.grade.score}
              {pointsPossible != null ? ` / ${pointsPossible}` : ""}
            </p>
            {submission.grade.feedbackHtml && (
              <p className="mt-2 text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">
                {submission.grade.feedbackHtml}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {canGrade && submission && (
        <Card>
          <CardHeader>
            <h2 className="font-medium">Grade (teacher)</h2>
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

      <p className="text-sm text-[var(--color-text-muted)]">
        <Link href="/school" className="underline">
          School
        </Link>{" "}
        / {className} / {assignmentTitle}
      </p>
    </div>
  );
}
