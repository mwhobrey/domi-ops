"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type {
  HealthReportExport,
  HealthReportEventItem,
  HealthReportFocus,
} from "../../lib/health-report-export";
import { SectionHeader } from "../ui";

function formatReportDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatReportDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function eventWhen(ev: HealthReportEventItem): string {
  return ev.startedAtLabel || formatReportDateTime(ev.startedAt) || ev.localDate || "—";
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="print-avoid-break rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 print:border-black/20 print:bg-white print:p-2">
      <p className="text-label text-[var(--color-text-muted)] print:text-black/70">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums print:text-lg">{value}</p>
    </div>
  );
}

function ReportTable({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  if (rows.length === 0) {
    return empty ? <p className="text-sm text-[var(--color-text-muted)]">{empty}</p> : null;
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] print:overflow-visible print:border-black/20">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)] print:bg-[#eee]">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 font-medium" scope="col">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function printTitle(focus: HealthReportFocus): string {
  if (focus === "medications-today") return "Today's medication doses";
  if (focus === "medication-list") return "Current medications";
  if (focus === "medications") return "Dose history";
  return "Health events";
}

function printSubtitle(focus: HealthReportFocus, report: HealthReportExport): string {
  if (focus === "medications-today") {
    return `${formatReportDate(report.todayDoseDate ?? report.to)} · Timezone: ${report.timezone}`;
  }
  if (focus === "medication-list") {
    return `As of ${formatReportDate(report.to)} · Timezone: ${report.timezone}`;
  }
  return `${formatReportDate(report.from)} – ${formatReportDate(report.to)} · Timezone: ${report.timezone}`;
}

export function HealthOverviewReportBody({
  report,
  focus = "overview",
}: {
  report: HealthReportExport;
  focus?: HealthReportFocus;
}) {
  const eventHistory = report.eventHistory?.length
    ? report.eventHistory
    : (report.recentEvents ?? []);
  const eventGroups =
    report.eventGroups && report.eventGroups.length > 0
      ? report.eventGroups
      : eventHistory.length > 0
        ? [{ key: "all", label: "All events", events: eventHistory }]
        : [];
  const logHistory = report.medicationLogHistory ?? [];
  const prnFrequency = report.prnFrequency ?? [];
  const todayDoses = report.todayDoses ?? [];
  const medList = (report.medications ?? []).filter((m) => m.enabled);
  const historyTitle =
    report.groupBy === "eventType"
      ? "Event history by type"
      : report.groupBy === "none"
        ? "Event history"
        : "Event history by date";

  const takenToday = todayDoses.filter((r) => r.status === "taken" || r.status === "prn").length;

  return (
    <div className="health-report-print report-print space-y-6">
      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">{printTitle(focus)}</h1>
        <p className="mt-1 text-sm text-black/70">{printSubtitle(focus, report)}</p>
      </div>

      <p className="text-sm text-[var(--color-text-muted)] print:hidden">
        Household timezone: <span className="font-medium">{report.timezone}</span>
        {report.eventType && focus === "overview" ? (
          <>
            {" "}
            · Filtered to{" "}
            <span className="font-medium">{report.eventsByType[0]?.label ?? report.eventType}</span>
          </>
        ) : null}
        {report.scheduleKind && focus !== "overview" && focus !== "medication-list" ? (
          <>
            {" "}
            · Schedule <span className="font-medium">{report.scheduleKind}</span>
          </>
        ) : null}
      </p>

      {focus === "overview" ? (
        <>
          <section className="space-y-3">
            <SectionHeader title="Clinical summary" />
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard label="Health events" value={report.summary.totalEvents} />
              <StatCard label="Ongoing now" value={report.summary.ongoingCount} />
            </div>
          </section>
          {report.eventsByType.length > 0 ? (
            <section className="space-y-2">
              <SectionHeader title="Events by type" />
              <ReportTable
                columns={["Type", "Count"]}
                rows={report.eventsByType.map((row) => [row.label, row.count])}
              />
            </section>
          ) : null}
          {report.eventsByMember.length > 0 ? (
            <section className="space-y-2">
              <SectionHeader title="Events by member" />
              <ReportTable
                columns={["Member", "Count"]}
                rows={report.eventsByMember.map((row) => [row.label, row.count])}
              />
            </section>
          ) : null}
          {eventGroups.length > 0 ? (
            <section className="space-y-4">
              <SectionHeader title={historyTitle} />
              {eventGroups.map((group) => (
                <div key={group.key} className="space-y-2">
                  {report.groupBy !== "none" ? (
                    <h3 className="text-sm font-medium text-[var(--color-text)]">
                      {group.label}
                      <span className="ml-2 font-normal text-[var(--color-text-muted)]">
                        ({group.events.length})
                      </span>
                    </h3>
                  ) : null}
                  <ReportTable
                    columns={["When", "Event", "Type", "Member"]}
                    rows={group.events.map((ev) => [
                      eventWhen(ev),
                      <>
                        <span className="hidden font-medium print:inline">{ev.title}</span>
                        <Link
                          href={`/health?event=${ev.id}`}
                          className="font-medium text-[var(--color-accent)] hover:underline print:hidden"
                        >
                          {ev.title}
                        </Link>
                        {ev.ongoing ? (
                          <span className="ml-2 text-[var(--color-text-muted)]">Ongoing</span>
                        ) : null}
                      </>,
                      ev.typeLabel,
                      ev.memberLabel,
                    ])}
                  />
                </div>
              ))}
            </section>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No events in this date range.</p>
          )}
        </>
      ) : null}

      {focus === "medications-today" ? (
        <>
          <section className="space-y-3">
            <SectionHeader title="Today" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Taken" value={takenToday} />
              <StatCard
                label="Skipped"
                value={todayDoses.filter((r) => r.status === "skipped").length}
              />
              <StatCard
                label="Missed"
                value={todayDoses.filter((r) => r.status === "missed").length}
              />
              <StatCard
                label="Pending"
                value={todayDoses.filter((r) => r.status === "pending").length}
              />
            </div>
          </section>
          <section className="space-y-2">
            <SectionHeader title="Doses" />
            <ReportTable
              columns={["When", "Logged", "Member", "Medication", "Dosage", "Status"]}
              empty="No doses scheduled or logged today."
              rows={todayDoses.map((row) => [
                row.scheduledAtLabel,
                row.loggedAtLabel ?? "—",
                row.memberLabel,
                row.medicationName,
                row.dosage ?? "—",
                row.statusLabel,
              ])}
            />
          </section>
        </>
      ) : null}

      {focus === "medication-list" ? (
        <section className="space-y-2">
          <SectionHeader title="Current medications" />
          <p className="text-sm text-[var(--color-text-muted)] print:hidden">
            Print or export this list to share dosage and instructions with medical personnel.
          </p>
          <ReportTable
            columns={["Member", "Medication", "Dosage", "Schedule", "Instructions"]}
            empty="No active medications."
            rows={medList.map((m) => [
              m.memberLabel,
              m.name,
              m.dosage ?? "—",
              m.scheduleSummary ?? m.scheduleKind,
              m.instructions ?? "—",
            ])}
          />
        </section>
      ) : null}

      {focus === "medications" ? (
        <>
          <section className="space-y-3">
            <SectionHeader title="Medication summary" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard label="Active medications" value={report.summary.activeMedications} />
              <StatCard label="Doses logged" value={report.summary.dosesLogged} />
              <StatCard label="Scheduled meds" value={report.summary.scheduledMedications} />
              <StatCard label="Interval meds" value={report.summary.intervalMedications ?? 0} />
              <StatCard label="PRN meds" value={report.summary.prnMedications} />
            </div>
          </section>
          {report.medicationAdherence.length > 0 ? (
            <section className="space-y-2">
              <SectionHeader title="Medication adherence" />
              <ReportTable
                columns={["Medication", "Member", "Kind", "Taken", "Missed", "Adherence"]}
                rows={report.medicationAdherence.map((row) => [
                  row.name,
                  row.memberLabel ?? "—",
                  row.scheduleKind,
                  row.scheduleKind === "prn" ? `${row.prn} PRN` : row.taken,
                  row.scheduleKind === "prn" ? "—" : row.missed,
                  row.scheduleKind === "prn"
                    ? "—"
                    : row.adherencePct != null
                      ? `${row.adherencePct}%`
                      : "No due doses yet",
                ])}
              />
            </section>
          ) : null}
          {prnFrequency.length > 0 ? (
            <section className="space-y-2">
              <SectionHeader title="PRN frequency by day" />
              <ReportTable
                columns={["Date", "Member", "Doses"]}
                rows={prnFrequency.map((row) => [
                  formatReportDate(row.date),
                  row.memberLabel,
                  row.count,
                ])}
              />
            </section>
          ) : null}
          {logHistory.length > 0 ? (
            <section className="space-y-2">
              <SectionHeader title="Medication log history" />
              <ReportTable
                columns={["When logged", "Scheduled", "Medication", "Member", "Status"]}
                rows={logHistory.map((log) => [
                  log.loggedAtLabel || formatReportDateTime(log.loggedAt),
                  log.scheduledAtLabel ||
                    (log.scheduledAt ? formatReportDateTime(log.scheduledAt) : "—"),
                  log.medicationName,
                  log.memberLabel,
                  log.prn ? `${log.status} (PRN)` : log.status,
                ])}
              />
            </section>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No dose logs in this date range.</p>
          )}
        </>
      ) : null}
    </div>
  );
}

export function defaultHealthReportRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
