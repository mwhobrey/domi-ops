import type { WeeklyReportGroup } from "../weekly-reports/types.js";

export type ReportModule = "school" | "chores" | "shopping" | "expenses" | "health";

export type ReportKind =
  | "weekly"
  | "overview"
  | "medications"
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
  medications: "Medications",
  "school-grades": "Grade summary",
  "school-open-work": "Open work",
  "school-transcript": "Transcript",
};
