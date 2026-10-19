"use client";

import { Download, FileText, FolderOpen, HardDrive, Printer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import {
  downloadReportFile,
  printReportHtml,
  type ReportDownloadFormat,
  type ReportPreviewDownloads,
} from "../../lib/report-export-client";
import type {
  ReportExportDestination,
  ReportExportParams,
  ReportRenderFormat,
} from "../../lib/reports";
import { reportExportBody } from "../../lib/reports";
import { createLatestGate } from "../../lib/latest-request";
import { Alert, Button, Select, Sheet, Spinner } from "../ui";

function PreviewBody({
  format,
  plainText,
  html,
}: {
  format: ReportRenderFormat;
  plainText: string;
  html: string;
}) {
  if (format === "styled") {
    return (
      <div
        className="max-h-[50vh] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-4 text-sm text-gray-900"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 text-sm">
      {plainText}
    </pre>
  );
}

type PreviewPayload = {
  plainText: string;
  html: string;
  filenameBase: string;
  downloads: ReportPreviewDownloads;
};

export function ReportExportSheet({
  open,
  onClose,
  exportParams,
  reportTitle,
  weekCount = 1,
  driveEnabled = true,
}: {
  open: boolean;
  onClose: () => void;
  exportParams: ReportExportParams;
  reportTitle: string;
  weekCount?: number;
  driveEnabled?: boolean;
}) {
  const [format, setFormat] = useState<ReportRenderFormat>("styled");
  const [downloadFormat, setDownloadFormat] = useState<ReportDownloadFormat>("csv");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [previewPending, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const previewKey = JSON.stringify([reportExportBody(exportParams), format]);
  const [previewResult, setPreviewResult] = useState<{
    key: string;
    preview: PreviewPayload | null;
    error: string | null;
  } | null>(null);
  const currentPreview = previewResult?.key === previewKey ? previewResult : null;
  const preview = currentPreview?.preview ?? null;
  const previewError = currentPreview?.error ?? null;
  const loading = previewPending || (open && currentPreview == null);
  const previewGate = useRef(createLatestGate());

  const exportNote =
    weekCount > 1
      ? `Cloud exports create one file per week (${weekCount} files). Preview and download include all weeks combined.`
      : null;

  const loadGoogleStatus = useCallback(async () => {
    try {
      const data = await apiClient.get<{ connected: boolean }>(
        "/api/core/reports/google-docs/status",
      );
      setGoogleConnected(data.connected);
    } catch {
      setGoogleConnected(false);
    }
  }, []);

  const loadPreview = useCallback(async () => {
    const requestId = previewGate.current.next();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await apiClient.post<{
        preview: PreviewPayload & { weekCount: number };
      }>("/api/core/reports/export", {
        ...reportExportBody(exportParams),
        format,
        destination: "preview",
      });
      if (!previewGate.current.isCurrent(requestId)) return;
      setPreviewResult({ key: previewKey, preview: data.preview, error: null });
    } catch (err) {
      if (!previewGate.current.isCurrent(requestId)) return;
      setPreviewResult({ key: previewKey, preview: null, error: err instanceof ApiError ? err.message : "Preview failed" });
    } finally {
      if (previewGate.current.isCurrent(requestId)) setLoading(false);
    }
  }, [exportParams, format, previewKey]);

  useEffect(() => {
    if (!open) return;
    void loadGoogleStatus();
  }, [open, loadGoogleStatus]);

  useEffect(() => {
    if (!open) return;
    void loadPreview();
    const gate = previewGate.current;
    return () => gate.cancel();
  }, [open, loadPreview]);

  async function runExport(target: ReportExportDestination) {
    setExporting(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await apiClient.post<{
        whomeDrive?: { objects: { objectId: string; title: string; url: string }[] };
        googleDocs?: { documents: { url: string; title: string }[] };
        googleDrive?: { files: { url: string; title: string }[] };
      }>("/api/core/reports/export", {
        ...reportExportBody(exportParams),
        format,
        destination: target,
      });
      if (data.whomeDrive?.objects.length) {
        const n = data.whomeDrive.objects.length;
        setSuccess(
          n === 1
            ? `Saved to Drive: ${data.whomeDrive.objects[0]!.title}`
            : `Saved ${n} files to Drive`,
        );
      } else if (data.googleDocs?.documents.length) {
        const n = data.googleDocs.documents.length;
        setSuccess(n === 1 ? "Opened in Google Docs" : `Created ${n} Google Docs`);
        for (const doc of data.googleDocs.documents) {
          window.open(doc.url, "_blank", "noopener,noreferrer");
        }
      } else if (data.googleDrive?.files.length) {
        const n = data.googleDrive.files.length;
        setSuccess(n === 1 ? "Saved to Google Drive" : `Saved ${n} files to Google Drive`);
        window.open(data.googleDrive.files[0]!.url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  function runDownload() {
    if (!preview) return;
    const content = preview.downloads[downloadFormat];
    downloadReportFile(preview.filenameBase, downloadFormat, content);
  }

  function runPrint() {
    if (!preview) return;
    printReportHtml(preview.html, reportTitle);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Export report"
      description={reportTitle}
      className="max-w-2xl"
    >
      <div className="space-y-4 px-6 py-4">
        <label className="block space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">Document format</span>
          <Select value={format} onChange={(e) => setFormat(e.target.value as ReportRenderFormat)}>
            <option value="styled">Styled tables</option>
            <option value="plain">Structured text</option>
          </Select>
          <span className="block text-xs text-[var(--color-text-muted)]">Applies to the preview and cloud exports.</span>
        </label>

        {exportNote ? <p className="text-sm text-[var(--color-text-muted)]">{exportNote}</p> : null}

        {!driveEnabled ? (
          <Alert variant="info">
            Enable the Drive module in household settings to save reports to Domi Ops Drive.
          </Alert>
        ) : null}

        {!googleConnected ? (
          <Alert variant="info">
            Connect Google Docs in{" "}
            <a href="/profile" className="underline">
              your profile
            </a>{" "}
            to export to Google Docs or Google Drive.
          </Alert>
        ) : null}

        {error || previewError ? <Alert variant="error">{error ?? previewError}</Alert> : null}
        {success ? <Alert variant="success">{success}</Alert> : null}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Preview</p>
            <Button type="button" size="sm" variant="secondary" onClick={() => void loadPreview()} disabled={loading}>
              Refresh preview
            </Button>
          </div>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : preview ? (
            <PreviewBody format={format} plainText={preview.plainText} html={preview.html} />
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No preview available.</p>
          )}
        </div>

        <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
          <fieldset className="min-w-0 space-y-2 rounded-lg border border-[var(--color-border)] px-3 pb-3">
            <legend className="px-1 text-sm font-medium">Save a document</legend>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void runExport("domi-ops-drive")}
                disabled={exporting || !driveEnabled}
                title={driveEnabled ? undefined : "Drive module is not enabled"}
              >
                <FolderOpen className="h-4 w-4" aria-hidden />
                Save to Drive
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void runExport("google-drive")}
                disabled={exporting || !googleConnected}
                title={googleConnected ? undefined : "Connect Google Docs in profile"}
              >
                <HardDrive className="h-4 w-4" aria-hidden />
                Google Drive
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void runExport("google-docs")}
                disabled={exporting || !googleConnected}
                title={googleConnected ? undefined : "Connect Google Docs in profile"}
              >
                <FileText className="h-4 w-4" aria-hidden />
                Google Docs
              </Button>
            </div>
          </fieldset>

          <fieldset className="min-w-0 space-y-2 rounded-lg border border-[var(--color-border)] px-3 pb-3">
            <legend className="px-1 text-sm font-medium">Download a file</legend>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="space-y-1 text-sm">
                <span className="text-[var(--color-text-muted)]">Download as</span>
                <Select
                  value={downloadFormat}
                  onChange={(e) => setDownloadFormat(e.target.value as ReportDownloadFormat)}
                  aria-label="Download format"
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                  <option value="yaml">YAML</option>
                </Select>
              </label>
              <Button
                type="button"
                variant="ghost"
                onClick={runDownload}
                disabled={!preview || loading}
              >
                <Download className="h-4 w-4" aria-hidden />
                Download
              </Button>
            </div>
          </fieldset>
          <div>
            <Button type="button" variant="ghost" onClick={runPrint} disabled={!preview || loading}>
              <Printer className="h-4 w-4" aria-hidden />
              Print report
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
