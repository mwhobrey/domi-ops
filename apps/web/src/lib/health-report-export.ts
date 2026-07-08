export interface HealthReportExport {
  from: string;
  to: string;
  timezone: string;
  summary: {
    totalEvents: number;
    ongoingCount: number;
    activeMedications: number;
    scheduledMedications: number;
    prnMedications: number;
    dosesLogged: number;
  };
  eventsByType: { type: string; label: string; count: number }[];
  eventsByMember: { memberId: string; label: string; count: number }[];
  medicationAdherence: {
    medicationId: string;
    name: string;
    scheduleKind: string;
    taken: number;
    skipped: number;
    missed: number;
    prn: number;
    scheduledTotal: number;
    adherencePct: number | null;
  }[];
  recentEvents: {
    id: string;
    title: string;
    typeLabel: string;
    memberLabel: string;
    ongoing: boolean;
    startedAt: string | null;
  }[];
}

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatReportDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function downloadHealthReportCsv(report: HealthReportExport) {
  const lines: string[] = [
    `Health report,${csvEscape(formatReportDate(report.from))} – ${csvEscape(formatReportDate(report.to))}`,
    `Timezone,${csvEscape(report.timezone)}`,
    "",
    "Summary",
    "Metric,Value",
    `Health events,${report.summary.totalEvents}`,
    `Ongoing now,${report.summary.ongoingCount}`,
    `Active medications,${report.summary.activeMedications}`,
    `Scheduled medications,${report.summary.scheduledMedications}`,
    `PRN medications,${report.summary.prnMedications}`,
    `Doses logged,${report.summary.dosesLogged}`,
  ];

  if (report.eventsByType.length > 0) {
    lines.push("", "Events by type", "Type,Count");
    for (const row of report.eventsByType) {
      lines.push(`${csvEscape(row.label)},${row.count}`);
    }
  }

  if (report.eventsByMember.length > 0) {
    lines.push("", "Events by member", "Member,Count");
    for (const row of report.eventsByMember) {
      lines.push(`${csvEscape(row.label)},${row.count}`);
    }
  }

  if (report.medicationAdherence.length > 0) {
    lines.push(
      "",
      "Medication logs",
      "Medication,Schedule,Taken,Skipped,Missed,PRN logs,Adherence %",
    );
    for (const row of report.medicationAdherence) {
      lines.push(
        [
          csvEscape(row.name),
          csvEscape(row.scheduleKind),
          row.taken,
          row.skipped,
          row.missed,
          row.prn,
          csvEscape(row.adherencePct != null ? `${row.adherencePct}%` : ""),
        ].join(","),
      );
    }
  }

  if (report.recentEvents.length > 0) {
    lines.push("", "Recent events", "Title,Type,Member,Ongoing,Started");
    for (const ev of report.recentEvents) {
      lines.push(
        [
          csvEscape(ev.title),
          csvEscape(ev.typeLabel),
          csvEscape(ev.memberLabel),
          ev.ongoing ? "Yes" : "No",
          csvEscape(ev.startedAt ? formatReportDate(ev.startedAt.slice(0, 10)) : ""),
        ].join(","),
      );
    }
  }

  const filename = `domi-ops-health-report-${report.from}-${report.to}.csv`;
  downloadBlob(filename, lines.join("\n"), "text/csv;charset=utf-8");
}

export function printHealthReport() {
  window.print();
}
