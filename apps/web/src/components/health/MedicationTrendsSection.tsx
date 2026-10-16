"use client";

import type { HealthReportExport } from "../../lib/health-report-export";
import { MARKER_VERB } from "../../lib/vitals-medication-overlay";
import { LazyTrendLineChart } from "../charts/lazy";
import { Badge, Card, CardBody, SectionHeader } from "../ui";
import { formatReportDate } from "../reports/HealthOverviewReportBody";

const DOSE_STATES = [
  { key: "taken", label: "Taken", color: "var(--color-success)" },
  { key: "skipped", label: "Skipped", color: "var(--color-warning)" },
  { key: "missed", label: "Missed", color: "var(--color-danger)" },
  { key: "pending", label: "Pending", color: "var(--color-text-muted)" },
] as const;

export function MedicationTrendsSection({ report }: { report: HealthReportExport }) {
  const medications = report.medicationAdherence ?? [];
  const markers = report.medicationMarkers ?? [];
  const frequency = report.prnFrequency ?? [];
  if (!medications.length && !markers.length && !frequency.length) return null;
  const start = Date.parse(`${report.from}T00:00:00Z`);
  const span = Math.max(1, Date.parse(`${report.to}T00:00:00Z`) - start);
  const markerMeds = [...new Map(markers.map((m) => [`${m.memberId}:${m.medicationId}`, m])).values()];

  return (
    <section className="space-y-4" aria-label="Medication trends">
      <SectionHeader title="Medication trends" />
      <p className="text-sm text-[var(--color-text-muted)]">Dose status for this range. Pending doses are still due; as-needed medication has no adherence target.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {medications.map((med) => {
          const total = med.taken + med.skipped + med.missed + (med.pending ?? 0);
          const asNeeded = med.scheduleKind === "prn" || med.scheduleKind === "otc";
          return (
            <Card key={`${med.memberId}:${med.medicationId}`}>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words font-medium">{med.name}</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">{med.memberLabel} · {med.scheduleKind === "interval" ? "Interval · logged doses only" : asNeeded ? "As needed" : "Scheduled"}</p>
                  </div>
                  <Badge>{asNeeded ? `${med.prn} logged` : med.adherencePct == null ? "No doses due" : `${med.adherencePct}% taken`}</Badge>
                </div>
                {!asNeeded && total > 0 ? (
                  <>
                    <div role="img" aria-label={DOSE_STATES.map((s) => `${med[s.key] ?? 0} ${s.label.toLowerCase()}`).join(", ")} className="flex h-3 overflow-hidden rounded-full bg-[var(--color-border)]">
                      {DOSE_STATES.map((s) => <span key={s.key} style={{ width: `${((med[s.key] ?? 0) / total) * 100}%`, background: s.color }} />)}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
                      {DOSE_STATES.map((s) => <span key={s.key} className="flex items-center gap-1"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: s.color }} />{med[s.key] ?? 0} {s.label.toLowerCase()}</span>)}
                    </div>
                  </>
                ) : <p className="text-sm text-[var(--color-text-muted)]">{asNeeded ? `${med.prn} as-needed doses logged` : "No scheduled dose history in this range."}</p>}
              </CardBody>
            </Card>
          );
        })}
      </div>
      {markers.length ? (
        <Card>
          <CardBody className="space-y-4">
            <h3 className="text-sm font-medium">Medication changes over time</h3>
            <div className="overflow-x-auto pb-2">
              <div className="min-w-[32rem] space-y-4 px-3">
                <div className="flex justify-between text-xs text-[var(--color-text-muted)]"><span>{formatReportDate(report.from)}</span><span>{formatReportDate(report.to)}</span></div>
                {markerMeds.map((med) => (
                  <div key={`${med.memberId}:${med.medicationId}`} className="space-y-2">
                    <p className="text-sm font-medium">{med.name}<span className="ml-2 font-normal text-[var(--color-text-muted)]">{med.memberLabel}</span></p>
                    <div className="relative h-7" role="img" aria-label={markers.filter((m) => m.medicationId === med.medicationId && m.memberId === med.memberId).map((m) => `${MARKER_VERB[m.kind]} ${formatReportDate(m.date)}`).join(", ")}>
                      <div className="absolute inset-x-0 top-3 border-t-2 border-[var(--color-border)]" />
                      {markers.filter((m) => m.medicationId === med.medicationId && m.memberId === med.memberId).map((m) => (
                        <span key={`${m.date}:${m.kind}`} title={`${MARKER_VERB[m.kind]} ${med.name} · ${formatReportDate(m.date)}`} style={{ left: `${Math.max(0, Math.min(100, ((Date.parse(`${m.date}T00:00:00Z`) - start) / span) * 100))}%` }} className="absolute top-1.5 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-[var(--color-accent)] text-[10px] font-bold text-white">{m.kind === "start" || m.kind === "resume" ? "+" : "−"}</span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">{markers.filter((m) => m.medicationId === med.medicationId && m.memberId === med.memberId).map((m) => <span key={`${m.date}:${m.kind}`}>{formatReportDate(m.date)} · {MARKER_VERB[m.kind]}</span>)}</div>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">+ Started or resumed · − Paused or stopped. Dose edits are not recorded in medication history.</p>
          </CardBody>
        </Card>
      ) : null}
      {frequency.length ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">As-needed doses over time</h3>
          <LazyTrendLineChart data={frequency.map((p) => ({ date: formatReportDate(p.date), value: p.count }))} series={[{ key: "value", label: "Doses logged" }]} height={200} />
        </div>
      ) : null}
    </section>
  );
}
