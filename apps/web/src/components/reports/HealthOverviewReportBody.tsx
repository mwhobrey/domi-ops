"use client";

import Link from "next/link";
import type { HealthReportExport } from "../../lib/health-report-export";
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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4 print:border-black/20 print:bg-white">
      <p className="text-label text-[var(--color-text-muted)] print:text-black/70">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function HealthOverviewReportBody({ report }: { report: HealthReportExport }) {
  return (
    <div className="health-report-print space-y-6">
      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">Health report</h1>
        <p className="mt-1 text-sm text-black/70">
          {formatReportDate(report.from)} – {formatReportDate(report.to)} · Timezone: {report.timezone}
        </p>
      </div>

      <p className="text-sm text-[var(--color-text-muted)] print:hidden">
        Household timezone: <span className="font-medium">{report.timezone}</span>
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Health events" value={report.summary.totalEvents} />
        <StatCard label="Ongoing now" value={report.summary.ongoingCount} />
        <StatCard label="Active medications" value={report.summary.activeMedications} />
        <StatCard label="Doses logged" value={report.summary.dosesLogged} />
        <StatCard label="Scheduled meds" value={report.summary.scheduledMedications} />
        <StatCard label="PRN meds" value={report.summary.prnMedications} />
      </div>

      {report.eventsByType.length > 0 ? (
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

      {report.eventsByMember.length > 0 ? (
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
          <SectionHeader title="Medication logs" />
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] print:border-black/20">
            {report.medicationAdherence.map((row) => (
              <li key={row.medicationId} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-[var(--color-text-muted)] print:text-black/70">
                    {row.scheduleKind === "prn"
                      ? `${row.prn} PRN logs`
                      : row.adherencePct != null
                        ? `${row.adherencePct}% taken`
                        : "No scheduled logs"}
                  </span>
                </div>
                {row.scheduleKind === "scheduled" && row.scheduledTotal > 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)] print:text-black/70">
                    Taken {row.taken} · Skipped {row.skipped} · Missed {row.missed}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.recentEvents.length > 0 ? (
        <section className="space-y-2">
          <SectionHeader title="Recent events" />
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] print:border-black/20">
            {report.recentEvents.map((ev) => (
              <li key={ev.id} className="px-4 py-3 text-sm">
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
