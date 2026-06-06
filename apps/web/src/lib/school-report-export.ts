import type {
  SchoolReportsData,
  TranscriptStudentRow,
} from "./school-reports";

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

export function downloadReportsSummaryCsv(reports: SchoolReportsData) {
  const lines = [
    ["Class", "Term", "Subject", "Students", "Assignments", "Average", "Weighted avg", "Missing", "Overdue", "Graded"].join(","),
    ...reports.classes.map((row) =>
      [
        csvEscape(row.className),
        csvEscape(row.term),
        csvEscape(row.subject),
        row.studentCount,
        row.assignmentCount,
        csvEscape(row.classAveragePercent),
        csvEscape(row.weightedClassAveragePercent),
        row.missingTotal,
        row.overdueTotal,
        row.gradedTotal,
      ].join(","),
    ),
  ];
  downloadBlob("whome-grade-summary.csv", lines.join("\n"), "text/csv;charset=utf-8");
}

export function downloadMissingDigestCsv(reports: SchoolReportsData) {
  const lines = [
    ["Student", "Class", "Assignment", "Status", "Due"].join(","),
    ...reports.missingDigest.map((row) =>
      [
        csvEscape(row.studentLabel),
        csvEscape(row.className),
        csvEscape(row.assignmentTitle),
        csvEscape(row.status),
        csvEscape(row.dueAt ? new Date(row.dueAt).toLocaleDateString() : ""),
      ].join(","),
    ),
  ];
  downloadBlob("whome-open-work.csv", lines.join("\n"), "text/csv;charset=utf-8");
}

export function downloadTranscriptCsv(transcript: TranscriptStudentRow) {
  const lines = [
    [`Student: ${transcript.label}`],
    [`Overall average: ${transcript.averagePercent ?? "—"}%`],
    [`Weighted average: ${transcript.weightedAveragePercent ?? "—"}%`],
    [],
    ["Class", "Term", "Assignment", "Category", "Score", "Points", "Percent", "Status"].join(","),
  ];

  for (const cls of transcript.classes) {
    for (const assignment of cls.assignments) {
      lines.push(
        [
          csvEscape(cls.className),
          csvEscape(cls.term),
          csvEscape(assignment.title),
          csvEscape(assignment.categoryName),
          csvEscape(assignment.score),
          assignment.pointsPossible,
          csvEscape(assignment.percent),
          csvEscape(assignment.status),
        ].join(","),
      );
    }
  }

  const slug = transcript.label.replace(/[^\w.-]+/g, "-").toLowerCase() || "student";
  downloadBlob(`whome-transcript-${slug}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
}

export function downloadAllTranscriptsCsv(reports: SchoolReportsData) {
  for (const transcript of reports.transcripts) {
    downloadTranscriptCsv(transcript);
  }
}
