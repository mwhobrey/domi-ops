"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../../lib/client-api";
import { ReportExportSheet } from "./ReportExportSheet";
import {
  defaultHealthReportRange,
  HealthOverviewReportBody,
  todayIsoDate,
} from "./HealthOverviewReportBody";
import { Alert, Button, Input, Select, Spinner } from "../ui";
import {
  HEALTH_REPORT_EVENT_TYPES,
  HEALTH_REPORT_FOCUS_OPTIONS,
  HEALTH_REPORT_SCHEDULE_KINDS,
  type HealthReportExport,
  type HealthReportFocus,
  type HealthReportGroupBy,
} from "../../lib/health-report-export";
import type { ReportKind } from "../../lib/reports";
import type { NoteShareMember } from "../NoteSharePicker";

export function HealthOverviewReportSection({
  initialFrom,
  initialTo,
  driveEnabled = true,
  members: membersProp,
  focus = "overview",
  showKindPicker = false,
  onFocusChange,
}: {
  initialFrom?: string;
  initialTo?: string;
  driveEnabled?: boolean;
  members?: NoteShareMember[];
  focus?: HealthReportFocus;
  showKindPicker?: boolean;
  onFocusChange?: (focus: HealthReportFocus) => void;
}) {
  const defaults = defaultHealthReportRange();
  const today = todayIsoDate();
  const [from, setFrom] = useState(initialFrom ?? defaults.from);
  const [to, setTo] = useState(initialTo ?? defaults.to);
  const [memberId, setMemberId] = useState("");
  const [eventType, setEventType] = useState("");
  const [groupBy, setGroupBy] = useState<HealthReportGroupBy>("date");
  const [medicationId, setMedicationId] = useState("");
  const [scheduleKind, setScheduleKind] = useState("");
  const [members, setMembers] = useState<NoteShareMember[]>(membersProp ?? []);
  const [report, setReport] = useState<HealthReportExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const [medOptions, setMedOptions] = useState<
    NonNullable<HealthReportExport["medications"]>
  >([]);

  const usesRange = focus === "overview" || focus === "medications";
  const usesMedFilters = focus === "medications" || focus === "medications-today";

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

  useEffect(() => {
    void apiClient
      .get<{
        medications: {
          id: string;
          name: string;
          scheduleKind: string;
          memberId: string;
          enabled: boolean;
        }[];
      }>("/api/health/medications")
      .then((data) => {
        setMedOptions(
          (data.medications ?? []).map((m) => ({
            id: m.id,
            name: m.name,
            scheduleKind: m.scheduleKind,
            memberId: m.memberId,
            memberLabel: "",
            enabled: m.enabled,
          })),
        );
      })
      .catch(() => setMedOptions([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queryFrom = focus === "medications-today" ? today : from;
      const queryTo = focus === "medications-today" ? today : to;
      const params = new URLSearchParams({ from: queryFrom, to: queryTo, groupBy });
      if (memberId) params.set("memberId", memberId);
      if (eventType && focus === "overview") params.set("eventType", eventType);
      if (medicationId && usesMedFilters) params.set("medicationId", medicationId);
      if (scheduleKind && usesMedFilters) params.set("scheduleKind", scheduleKind);
      const data = await apiClient.get<HealthReportExport>(`/api/health/reports?${params}`);
      setReport(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load reports");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, memberId, eventType, groupBy, medicationId, scheduleKind, focus, today, usesMedFilters]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportKind: ReportKind =
    focus === "medications"
      ? "medications"
      : focus === "medications-today"
        ? "medications-today"
        : focus === "medication-list"
          ? "medication-list"
          : "overview";

  const exportParams = useMemo(
    () => ({
      module: "health" as const,
      kind: exportKind,
      from: focus === "medications-today" ? today : from,
      to: focus === "medications-today" ? today : to,
      memberId: memberId || null,
      eventType: focus === "overview" ? eventType || null : null,
      groupBy: focus === "overview" ? groupBy : null,
      medicationId: usesMedFilters ? medicationId || null : null,
      scheduleKind: usesMedFilters ? scheduleKind || null : null,
    }),
    [exportKind, from, to, today, memberId, eventType, groupBy, medicationId, scheduleKind, focus, usesMedFilters],
  );

  const exportTitle = report
    ? focus === "medications-today"
      ? `Today's doses — ${report.todayDoseDate ?? report.to}`
      : focus === "medication-list"
        ? "Current medications"
        : `${focus === "medications" ? "Dose history" : "Health events"} — ${report.from} to ${report.to}`
    : HEALTH_REPORT_FOCUS_OPTIONS.find((o) => o.id === focus)?.label ?? "Health report";

  return (
    <div className="space-y-6">
      {showKindPicker ? (
        <nav aria-label="Health report type" className="no-print flex flex-wrap gap-2">
          {HEALTH_REPORT_FOCUS_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-current={option.id === focus ? "page" : undefined}
              className={`rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors ${
                option.id === focus
                  ? "bg-[var(--color-accent-subtle)] text-[var(--color-text)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-text)]"
              }`}
              onClick={() => onFocusChange?.(option.id)}
            >
              {option.label}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="no-print flex flex-wrap items-end gap-3">
        {usesRange ? (
          <>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--color-text-muted)]">From</span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--color-text-muted)]">To</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        ) : null}
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
        {usesMedFilters ? (
          <>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--color-text-muted)]">Medication</span>
              <Select value={medicationId} onChange={(e) => setMedicationId(e.target.value)}>
                <option value="">All medications</option>
                {medOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--color-text-muted)]">Schedule</span>
              <Select value={scheduleKind} onChange={(e) => setScheduleKind(e.target.value)}>
                <option value="">All kinds</option>
                {HEALTH_REPORT_SCHEDULE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </label>
          </>
        ) : null}
        {focus === "overview" ? (
          <>
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
          </>
        ) : null}
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

      {report ? <HealthOverviewReportBody report={report} focus={focus} /> : null}

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
  const [focus, setFocus] = useState<HealthReportFocus>("overview");
  return (
    <HealthOverviewReportSection
      driveEnabled={props.driveEnabled}
      members={props.members}
      focus={focus}
      showKindPicker
      onFocusChange={setFocus}
    />
  );
}
