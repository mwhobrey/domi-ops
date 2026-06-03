"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { Alert, Button, Card, CardBody, CardHeader, Input, Textarea } from "./ui";

interface Submission {
  id: string;
  status: string;
  studentNote: string;
  artifacts: { id: string; artifactType: string; s3Key: string | null; url: string | null }[];
  grade: { score: number | null; feedbackHtml: string } | null;
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className="rounded-full bg-[var(--color-border)]/50 px-2 py-0.5 text-xs uppercase tracking-wide">
      {status}
    </span>
  );
}

export function SchoolAssignmentDetail({
  assignmentId,
  assignmentTitle,
  className,
  initialSubmissions,
}: {
  assignmentId: string;
  assignmentTitle: string;
  className: string;
  initialSubmissions: Submission[];
}) {
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [note, setNote] = useState("");
  const [score, setScore] = useState("");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitWork() {
    setError(null);
    try {
      const data = await apiClient.post<{ submission: Submission }>(
        `/api/school/assignments/${assignmentId}/submit`,
        { studentNote: note },
      );
      setSubmissions((prev) => {
        const rest = prev.filter((s) => s.id !== data.submission.id);
        return [...rest, { ...data.submission, artifacts: [], grade: null }];
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Submit failed");
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
      await apiClient.post(`/api/school/submissions/${submissionId}/artifacts`, {
        artifactType: "file",
        s3Key: key,
      });
      setUploadStatus("Uploaded");
    } catch {
      setUploadStatus("Upload failed");
      setUploadError(true);
    }
  }

  const submission = submissions[0];

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}
      <p className="text-sm text-[var(--color-text-muted)]">
        <Link href="/school" className="underline">
          School
        </Link>{" "}
        / {className} / {assignmentTitle}
      </p>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="font-medium">1. Submit work</h2>
          {submission && <StatusChip status={submission.status} />}
        </CardHeader>
        <CardBody>
          <Textarea
            placeholder="Student note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button className="mt-3" onClick={submitWork}>
            Submit assignment
          </Button>
        </CardBody>
      </Card>

      {submission && (
        <Card>
          <CardHeader>
            <h2 className="font-medium">2. Upload artifact</h2>
          </CardHeader>
          <CardBody>
            <input
              type="file"
              className="text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f, submission.id);
              }}
            />
            {uploadStatus && (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">{uploadStatus}</p>
            )}
            {uploadError && <Alert variant="error">Upload failed — check presign / MinIO.</Alert>}
          </CardBody>
        </Card>
      )}

      {submission && (
        <Card>
          <CardHeader>
            <h2 className="font-medium">3. Grade (teacher)</h2>
          </CardHeader>
          <CardBody>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await apiClient.post(`/api/school/submissions/${submission.id}/grade`, {
                  score: parseFloat(score),
                });
              }}
            >
              <Input
                className="w-28"
                placeholder="Score"
                value={score}
                onChange={(e) => setScore(e.target.value)}
              />
              <Button type="submit" variant="secondary">
                Save grade
              </Button>
            </form>
            {submission.grade?.score != null && (
              <p className="mt-2 text-sm">Current score: {submission.grade.score}</p>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
