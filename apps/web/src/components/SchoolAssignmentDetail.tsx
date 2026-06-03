"use client";

import Link from "next/link";
import { useState } from "react";

interface Submission {
  id: string;
  status: string;
  studentNote: string;
  artifacts: { id: string; artifactType: string; s3Key: string | null; url: string | null }[];
  grade: { score: number | null; feedbackHtml: string } | null;
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

  async function submitWork() {
    const res = await fetch(`/api/school/assignments/${assignmentId}/submit`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentNote: note }),
    });
    if (res.ok) {
      const data = (await res.json()) as { submission: Submission };
      setSubmissions((prev) => {
        const rest = prev.filter((s) => s.id !== data.submission.id);
        return [...rest, { ...data.submission, artifacts: [], grade: null }];
      });
    }
  }

  async function uploadFile(file: File, submissionId: string) {
    setUploadStatus("Presigning…");
    const presign = await fetch("/api/school-upload/presign", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
    });
    if (!presign.ok) {
      setUploadStatus("Presign failed");
      return;
    }
    const { uploadUrl, key } = (await presign.json()) as { uploadUrl: string; key: string };
    setUploadStatus("Uploading…");
    const put = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
    if (!put.ok) {
      setUploadStatus("Upload failed");
      return;
    }
    await fetch(`/api/school/submissions/${submissionId}/artifacts`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifactType: "file", s3Key: key }),
    });
    setUploadStatus("Uploaded");
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--color-text-muted)]">
        <Link href="/school" className="underline">
          School
        </Link>{" "}
        / {className} / {assignmentTitle}
      </p>
      <section className="rounded-2xl border border-[var(--color-border)] p-4">
        <h2 className="mb-2 font-medium">Submit work</h2>
        <textarea
          className="mb-2 min-h-[80px] w-full rounded-lg border border-[var(--color-border)] bg-transparent p-2 text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Student note"
        />
        <button
          type="button"
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white"
          onClick={submitWork}
        >
          Submit assignment
        </button>
      </section>
      {submissions[0] && (
        <section className="rounded-2xl border border-[var(--color-border)] p-4">
          <h2 className="mb-2 font-medium">Upload artifact</h2>
          <input
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f, submissions[0].id);
            }}
          />
          {uploadStatus && <p className="mt-2 text-xs text-[var(--color-text-muted)]">{uploadStatus}</p>}
        </section>
      )}
      <section>
        <h2 className="mb-2 font-medium">Grade (teacher)</h2>
        {submissions[0] && (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await fetch(`/api/school/submissions/${submissions[0].id}/grade`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ score: parseFloat(score) }),
              });
            }}
          >
            <input
              className="w-24 rounded-lg border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm"
              placeholder="Score"
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
            <button type="submit" className="rounded-lg border border-[var(--color-border)] px-3 py-1 text-sm">
              Save grade
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
