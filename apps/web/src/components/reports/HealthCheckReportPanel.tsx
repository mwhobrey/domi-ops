"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { Alert, Button, Input, Select, Spinner } from "../ui";
import type { NoteShareMember } from "../NoteSharePicker";
import { defaultHealthReportRange } from "./HealthOverviewReportBody";
import { CanonicalReportView, type CanonicalReportData } from "./CanonicalReportView";
import { ReportExportSheet } from "./ReportExportSheet";

export type HealthCheckReportKind = "check-adherence" | "blood-pressure";

const ERROR_TEXT: Record<string, string> = {
  invalid_date: "One of the dates is not valid.",
  end_before_start: "The end date is before the start date.",
  range_too_large: "That range is too long. Pick a year or less.",
};

export function reportErrorMessage(err: unknown): string {
  if (err instanceof ApiError && typeof err.body === "string") {
    try {
      const code = (JSON.parse(err.body) as { error?: unknown }).error;
      if (typeof code === "string" && ERROR_TEXT[code]) return ERROR_TEXT[code]!;
    } catch {
      // not JSON
    }
  }
  return "Failed to load the report";
}

/**
 * The scheduled-check reports (WHO-393): how well checks were kept, and blood pressure readings for
 * a doctor. Both come from the shared canonical report, so what is on screen is what exports.
 */
export function HealthCheckReportPanel({
  kind,
  members: membersProp,
  driveEnabled = true,
}: {
  kind: HealthCheckReportKind;
  members?: NoteShareMember[];
  driveEnabled?: boolean;
}) {
  const defaults = defaultHealthReportRange();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [memberId, setMemberId] = useState("");
  const [members, setMembers] = useState<NoteShareMember[]>(membersProp ?? []);
  const [report, setReport] = useState<CanonicalReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (membersProp?.length) {
      setMembers(membersProp);
      return;
    }
    void apiClient
      .get<{ members: NoteShareMember[] }>("/api/core/household/roster")
      .then((data) => setMembers(data.members ?? []))
      .catch(() => setMembers([]));
  }, [membersProp]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ module: "health", kind, from, to });
      if (memberId) params.set("memberId", memberId);
      const data = await apiClient.get<{ report: CanonicalReportData }>(`/api/core/reports?${params}`);
      setReport(data.report);
    } catch (err) {
      setError(reportErrorMessage(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [kind, from, to, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportParams = useMemo(
    () => ({ module: "health" as const, kind, from, to, memberId: memberId || null }),
    [kind, from, to, memberId],
  );

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">From</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">To</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">Member</span>
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">All members</option>
            {members.map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.label || m.memberId.slice(0, 8)}
              </option>
            ))}
          </Select>
        </label>
        <Button size="sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
        {report ? (
          <Button type="button" size="sm" onClick={() => setExportOpen(true)}>
            Export…
          </Button>
        ) : null}
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading && !report ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : null}
      {report ? <CanonicalReportView report={report} /> : null}

      <ReportExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        exportParams={exportParams}
        reportTitle={report?.title ?? (kind === "blood-pressure" ? "Blood pressure" : "Check adherence")}
        driveEnabled={driveEnabled}
      />
    </div>
  );
}
