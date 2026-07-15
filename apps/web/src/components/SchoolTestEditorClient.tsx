"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { googleDocsConnectUrl } from "../lib/auth-links";
import { ApiError, apiClient } from "../lib/client-api";
import type { SchoolNativeTestPointsMode } from "../lib/school-test-questions";
import { SchoolTestQuestionEditor } from "./SchoolTestQuestionEditor";
import { Alert, AnchorButton, Badge, Button, Checkbox, Input, Modal } from "./ui";

function apiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  if (!err.body) return err.message;
  try {
    const parsed = JSON.parse(err.body) as { message?: string; error?: string };
    return parsed.message || parsed.error || err.message;
  } catch {
    return err.message;
  }
}

function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.body) return null;
  try {
    const parsed = JSON.parse(err.body) as { error?: string };
    return parsed.error ?? null;
  } catch {
    return null;
  }
}

export function SchoolTestEditorClient({
  assignmentId,
  materialId,
  assignmentTitle,
  classId,
  className,
  initialDisplayName,
  initialPointsMode,
  assignmentPointsPossible,
  frozen,
}: {
  assignmentId: string;
  materialId: string;
  assignmentTitle: string;
  classId: string;
  className: string;
  initialDisplayName: string;
  initialPointsMode: SchoolNativeTestPointsMode;
  assignmentPointsPossible: number | null;
  frozen: boolean;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [savedName, setSavedName] = useState(initialDisplayName);
  const [pointsMode, setPointsMode] = useState(initialPointsMode);
  const [error, setError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [includeAnswerKey, setIncludeAnswerKey] = useState(false);
  const [docsConnected, setDocsConnected] = useState<boolean | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ url: string } | null>(null);

  const loadDocsStatus = useCallback(async () => {
    try {
      const data = await apiClient.get<{ connected: boolean }>(
        "/api/core/reports/google-docs/status",
      );
      setDocsConnected(data.connected);
    } catch {
      setDocsConnected(false);
    }
  }, []);

  useEffect(() => {
    void loadDocsStatus();
  }, [loadDocsStatus]);

  async function saveDisplayName() {
    const next = displayName.trim();
    if (!next || next === savedName) return;
    setSavingName(true);
    setError(null);
    try {
      await apiClient.patch(`/api/school/assignments/${assignmentId}/materials/${materialId}`, {
        displayName: next,
      });
      setSavedName(next);
      setDisplayName(next);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not rename test"));
      setDisplayName(savedName);
    } finally {
      setSavingName(false);
    }
  }

  async function onPointsModeChange(mode: SchoolNativeTestPointsMode) {
    setError(null);
    try {
      await apiClient.patch(`/api/school/assignments/${assignmentId}/materials/${materialId}`, {
        nativeTestPointsMode: mode,
      });
      setPointsMode(mode);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not update points mode"));
    }
  }

  async function exportToGoogleDoc() {
    setExporting(true);
    setError(null);
    setExportResult(null);
    try {
      const data = await apiClient.post<{ url: string }>(
        `/api/school/assignments/${assignmentId}/materials/${materialId}/export-google-doc`,
        { includeAnswerKey },
      );
      setExportResult({ url: data.url });
    } catch (err) {
      const code = apiErrorCode(err);
      if (code === "google_docs_not_connected" || code === "google_docs_token_revoked") {
        setDocsConnected(false);
      }
      setError(apiErrorMessage(err, "Could not export Google Doc"));
    } finally {
      setExporting(false);
    }
  }

  const connectHref = `${googleDocsConnectUrl()}?next=${encodeURIComponent(
    `/school/assignment/${assignmentId}/materials/${materialId}/edit`,
  )}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-[var(--color-text-muted)]">
            <Link
              href={`/school/class/${classId}`}
              className="underline-offset-2 hover:underline"
            >
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
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl font-semibold tracking-tight">Edit in-app test</h2>
            {frozen ? <Badge tone="warning">Frozen</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setExportResult(null);
              setError(null);
              setExportOpen(true);
            }}
          >
            Export to Google Doc
          </Button>
          <AnchorButton href={`/school/assignment/${assignmentId}`} variant="ghost">
            Back to assignment
          </AnchorButton>
        </div>
      </div>

      {error && !exportOpen ? <Alert variant="error">{error}</Alert> : null}

      {frozen ? (
        <Alert variant="info">
          This test froze after the first household submission. Questions are read-only; you can
          still export a Google Doc backup.
        </Alert>
      ) : null}

      <div className="space-y-2">
        <label className="block space-y-1.5">
          <span className="text-label text-[var(--color-text-muted)]">Test title</span>
          <div className="flex flex-wrap gap-2">
            <Input
              value={displayName}
              disabled={frozen}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={() => void saveDisplayName()}
              className="max-w-md flex-1"
              aria-label="Test title"
            />
            {!frozen ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={savingName}
                onClick={() => void saveDisplayName()}
              >
                Save title
              </Button>
            ) : null}
          </div>
        </label>
        <p className="text-xs text-[var(--color-text-muted)]">
          Students see this name on the assignment materials list. Export creates a one-way Google
          Doc backup for printing or external archive — it does not replace the in-app test.
        </p>
      </div>

      <SchoolTestQuestionEditor
        assignmentId={assignmentId}
        materialId={materialId}
        pointsMode={pointsMode}
        assignmentPointsPossible={assignmentPointsPossible}
        frozen={frozen}
        onPointsModeChange={onPointsModeChange}
      />

      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export to Google Doc"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Creates a Google Doc in your Drive for posterity or printing. The live in-app test stays
            in Domi Ops; this is a one-way backup.
          </p>
          <Checkbox
            label="Include answer key section"
            checked={includeAnswerKey}
            onChange={(e) => setIncludeAnswerKey(e.target.checked)}
          />
          {docsConnected === false ? (
            <Alert variant="info">
              Connect Google Docs first, then return here to export.{" "}
              <a href={connectHref} className="font-medium underline-offset-2 hover:underline">
                Connect Google Docs
              </a>
            </Alert>
          ) : null}
          {error && exportOpen ? <Alert variant="error">{error}</Alert> : null}
          {exportResult ? (
            <Alert variant="success">
              Doc created.{" "}
              <a
                href={exportResult.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline-offset-2 hover:underline"
              >
                Open in Google Docs
              </a>
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setExportOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              loading={exporting}
              disabled={docsConnected !== true}
              onClick={() => void exportToGoogleDoc()}
            >
              Create Google Doc
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
