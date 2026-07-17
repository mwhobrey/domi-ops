"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { ReportExportSheet } from "./ReportExportSheet";
import { defaultHealthReportRange, HealthOverviewReportBody } from "./HealthOverviewReportBody";
import { Alert, Button, Input, Select, Spinner } from "../ui";
import {
  HEALTH_REPORT_EVENT_TYPES,
  type HealthReportExport,
  type HealthReportGroupBy,
} from "../../lib/health-report-export";
import type { NoteShareMember } from "../NoteSharePicker";

export function HealthOverviewReportSection({
  initialFrom,
  initialTo,
  driveEnabled = true,
  members: membersProp,
}: {
  initialFrom?: string;
  initialTo?: string;
  driveEnabled?: boolean;
  members?: NoteShareMember[];
}) {
  const defaults = defaultHealthReportRange();
  const [from, setFrom] = useState(initialFrom ?? defaults.from);
  const [to, setTo] = useState(initialTo ?? defaults.to);
  const [memberId, setMemberId] = useState("");
  const [eventType, setEventType] = useState("");
  const [groupBy, setGroupBy] = useState<HealthReportGroupBy>("date");
  const [members, setMembers] = useState<NoteShareMember[]>(membersProp ?? []);
  const [report, setReport] = useState<HealthReportExport | null>(null);
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
      const params = new URLSearchParams({ from, to, groupBy });
      if (memberId) params.set("memberId", memberId);
      if (eventType) params.set("eventType", eventType);
      const data = await apiClient.get<HealthReportExport>(`/api/health/reports?${params}`);
      setReport(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load reports");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, memberId, eventType, groupBy]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportParams = useMemo(
    () => ({
      module: "health" as const,
      kind: "overview" as const,
      from,
      to,
      memberId: memberId || null,
      eventType: eventType || null,
      groupBy,
    }),
    [from, to, memberId, eventType, groupBy],
  );

  const exportTitle = report
    ? `Health report — ${report.from} to ${report.to}`
    : "Health report";

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
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">Event type</span>
          <Select value={eventType} onChange={(e) => setEventType(e.target.value)}>
            <option value="">All events</option>
            {HEALTH_REPORT_EVENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-text-muted)]">Group by</span>
          <Select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as HealthReportGroupBy)}
          >
            <option value="date">Date</option>
            <option value="eventType">Event type</option>
            <option value="none">None (flat list)</option>
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

      {report ? <HealthOverviewReportBody report={report} /> : null}

      <ReportExportSheet
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        exportParams={exportParams}
        reportTitle={exportTitle}
        driveEnabled={driveEnabled}
      />
    </div>
  );
}

export function HealthReportsClient(props: {
  driveEnabled?: boolean;
  members?: NoteShareMember[];
}) {
  return (
    <HealthOverviewReportSection
      driveEnabled={props.driveEnabled}
      members={props.members}
    />
  );
}
