"use client";

import Link from "next/link";
import type { HealthReportExport, HealthReportEventItem } from "../../lib/health-report-export";
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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 print:border-black/20 print:bg-white">
      <p className="text-label text-[var(--color-text-muted)] print:text-black/70">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function EventHistoryItem({ ev }: { ev: HealthReportEventItem }) {
  return (
    <li className="px-4 py-3 text-sm">
      <span className="hidden font-medium print:inline">{ev.title}</span>
      <Link
        href={`/health?event=${ev.id}`}
        className="font-medium text-[var(--color-accent)] hover:underline print:hidden"
      >
        {ev.title}
      </Link>
      <p className="text-[var(--color-text-muted)] print:text-black/70">
        {ev.typeLabel} · {ev.memberLabel}
        {ev.ongoing ? " · Ongoing" : ""}
        {ev.startedAt
          ? ` · ${formatReportDateTime(ev.startedAt)}`
          : ev.localDate
            ? ` · ${formatReportDate(ev.localDate)}`
            : ""}
      </p>
    </li>
  );
}

export function HealthOverviewReportBody({
  report,
  focus = "overview",
}: {
  report: HealthReportExport;
  focus?: "overview" | "medications";
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
  const historyTitle =
    report.groupBy === "eventType"
      ? "Event history by type"
      : report.groupBy === "none"
        ? "Event history"
        : "Event history by date";
  const showEvents = focus === "overview";

  return (
    <div className="health-report-print space-y-6">
      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">
          {focus === "medications" ? "Medication report" : "Health report"}
        </h1>
        <p className="mt-1 text-sm text-black/70">
          {formatReportDate(report.from)} – {formatReportDate(report.to)} · Timezone: {report.timezone}
        </p>
      </div>

      <p className="text-sm text-[var(--color-text-muted)] print:hidden">
        Household timezone: <span className="font-medium">{report.timezone}</span>
        {report.eventType ? (
          <>
            {" "}
            · Filtered to{" "}
            <span className="font-medium">
              {report.eventsByType[0]?.label ?? report.eventType}
            </span>
          </>
        ) : null}
        {report.scheduleKind ? (
          <>
            {" "}
            · Schedule <span className="font-medium">{report.scheduleKind}</span>
          </>
        ) : null}
      </p>

      <section className="space-y-3">
        <SectionHeader title={focus === "medications" ? "Medication summary" : "Clinical summary"} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {showEvents ? <StatCard label="Health events" value={report.summary.totalEvents} /> : null}
          {showEvents ? <StatCard label="Ongoing now" value={report.summary.ongoingCount} /> : null}
          <StatCard label="Active medications" value={report.summary.activeMedications} />
          <StatCard label="Doses logged" value={report.summary.dosesLogged} />
          <StatCard label="Scheduled meds" value={report.summary.scheduledMedications} />
          <StatCard label="Interval meds" value={report.summary.intervalMedications ?? 0} />
          <StatCard label="PRN meds" value={report.summary.prnMedications} />
        </div>
      </section>

      {showEvents && report.eventsByType.length > 0 ? (
        <section className="space-y-2">
          <SectionHeader title="Events by type" />
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] print:border-black/20">
            {report.eventsByType.map((row) => (
              <li key={row.type} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{row.label}</span>
                <span className="font-medium tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showEvents && report.eventsByMember.length > 0 ? (
        <section className="space-y-2">
          <SectionHeader title="Events by member" />
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] print:border-black/20">
            {report.eventsByMember.map((row) => (
              <li key={row.memberId} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{row.label}</span>
                <span className="font-medium tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.medicationAdherence.length > 0 ? (
        <section className="space-y-2">
          <SectionHeader title="Medication adherence" />
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] print:border-black/20">
            {report.medicationAdherence.map((row) => (
              <li key={row.medicationId} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {row.name}
                    {row.memberLabel ? (
                      <span className="font-normal text-[var(--color-text-muted)]">
                        {" "}
                        · {row.memberLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[var(--color-text-muted)] print:text-black/70">
                    {row.scheduleKind === "prn"
                      ? `${row.prn} PRN logs`
                      : row.adherencePct != null
                        ? `${row.adherencePct}% taken`
                        : "No due doses yet"}
                  </span>
                </div>
                {row.scheduleKind !== "prn" ? (
                  <p className="text-xs text-[var(--color-text-muted)] print:text-black/70">
                    Expected {row.expected ?? row.scheduledTotal} · Taken {row.taken} · Skipped{" "}
                    {row.skipped} · Missed {row.missed}
                    {(row.pending ?? 0) > 0 ? ` · Pending ${row.pending}` : ""}
                    {row.prn > 0 ? ` · PRN ${row.prn}` : ""}
                  </p>
                ) : row.prn > 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)] print:text-black/70">
                    {row.prn} as-needed dose{row.prn === 1 ? "" : "s"} logged
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {prnFrequency.length > 0 ? (
        <section className="space-y-2">
          <SectionHeader title="PRN frequency by day" />
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] print:border-black/20">
            {prnFrequency.map((row) => (
              <li
                key={`${row.date}-${row.memberId}`}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <span>
                  {formatReportDate(row.date)} · {row.memberLabel}
                </span>
                <span className="font-medium tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showEvents && eventGroups.length > 0 ? (
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
              <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] print:border-black/20">
                {group.events.map((ev) => (
                  <EventHistoryItem key={ev.id} ev={ev} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {logHistory.length > 0 ? (
        <section className="space-y-2">
          <SectionHeader title="Medication log history" />
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] print:border-black/20">
            {logHistory.map((log) => (
              <li key={log.id} className="px-4 py-3 text-sm">
                <p className="font-medium">{log.medicationName}</p>
                <p className="text-[var(--color-text-muted)] print:text-black/70">
                  {log.memberLabel} · {log.prn ? `${log.status} (PRN)` : log.status} ·{" "}
                  {formatReportDateTime(log.loggedAt)}
                  {log.scheduledAt ? ` · scheduled ${formatReportDateTime(log.scheduledAt)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
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
