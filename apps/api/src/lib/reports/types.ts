import type { WeeklyReportGroup } from "../weekly-reports/types.js";

export type ReportModule = "school" | "chores" | "shopping" | "expenses" | "health";

export type ReportKind =
  | "weekly"
  | "overview"
  | "medications"
  | "medications-today"
  | "medication-list"
  | "school-grades"
  | "school-open-work"
  | "school-transcript";

export type ReportRenderFormat = "plain" | "styled";

export type ReportDownloadFormat = "csv" | "json" | "yaml";

export type ReportExportDestination =
  | "preview"
  | "domi-ops-drive"
  | "google-docs"
  | "google-drive";

export interface ReportStatRow {
  label: string;
  value: string;
}

export interface ReportTableSection {
  key: string;
  label: string;
  columns: string[];
  rows: (string | number | null)[][];
}

export interface CanonicalReportSection {
  key: string;
  label: string;
  stats?: ReportStatRow[];
  tables?: ReportTableSection[];
  groups?: WeeklyReportGroup[];
  emptyMessage?: string;
}

export interface CanonicalReport {
  title: string;
  module: ReportModule;
  kind: ReportKind;
  generatedAt: string;
  timezone?: string;
  sections: CanonicalReportSection[];
  /** When true, export may produce multiple files (weekly range). */
  multiPart?: boolean;
  parts?: CanonicalReport[];
}

export interface ReportCatalogEntry {
  module: ReportModule;
  moduleLabel: string;
  kinds: { id: ReportKind; label: string; description?: string }[];
}

export const REPORT_MODULE_LABELS: Record<ReportModule, string> = {
  school: "School",
  chores: "Chores",
  shopping: "Shopping",
  expenses: "Expenses",
  health: "Health",
};

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  weekly: "Weekly schedule",
  overview: "Overview",
  medications: "Dose history",
  "medications-today": "Today's doses",
  "medication-list": "Medication list",
  "school-grades": "Grade summary",
  "school-open-work": "Open work",
  "school-transcript": "Transcript",
};

export const HEALTH_REPORT_KINDS: { id: ReportKind; label: string; description: string }[] = [
  {
    id: "overview",
    label: "Events",
    description: "Clinical events in a date range",
  },
  {
    id: "medications-today",
    label: "Today's doses",
    description: "Taken, skipped, missed, and pending doses for today",
  },
  {
    id: "medications",
    label: "Dose history",
    description: "Adherence and medication logs for a date range",
  },
  {
    id: "medication-list",
    label: "Medication list",
    description: "Current medications with dosage and instructions",
  },
];
