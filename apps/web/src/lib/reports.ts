export type ReportModule = "school" | "chores" | "shopping" | "expenses" | "health";

export type ReportKind =
  | "weekly"
  | "overview"
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

export interface ReportExportParams {
  module: ReportModule;
  kind: ReportKind;
  variant?: string;
  weekStart?: string | null;
  from?: string | null;
  to?: string | null;
  month?: string | null;
  term?: string | null;
  studentMemberId?: string | null;
  memberId?: string | null;
  eventType?: string | null;
  groupBy?: string | null;
}

export interface ReportCatalogEntry {
  module: ReportModule;
  moduleLabel: string;
  kinds: { id: ReportKind; label: string; description?: string }[];
}

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  weekly: "Weekly schedule",
  overview: "Overview",
  "school-grades": "Grade summary",
  "school-open-work": "Open work",
  "school-transcript": "Transcript",
};

export const REPORT_MODULE_LABELS: Record<ReportModule, string> = {
  school: "School",
  chores: "Chores",
  shopping: "Shopping",
  expenses: "Expenses",
  health: "Health",
};

export function reportExportBody(params: ReportExportParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    module: params.module,
    kind: params.kind,
  };
  if (params.variant) body.variant = params.variant;
  if (params.weekStart) body.weekStart = params.weekStart;
  if (params.from) body.from = params.from;
  if (params.to) body.to = params.to;
  if (params.month) body.month = params.month;
  if (params.term) body.term = params.term;
  if (params.studentMemberId) body.studentMemberId = params.studentMemberId;
  if (params.memberId) body.memberId = params.memberId;
  if (params.eventType) body.eventType = params.eventType;
  if (params.groupBy) body.groupBy = params.groupBy;
  return body;
}

export function reportsHubUrl(module: ReportModule, kind?: ReportKind): string {
  const params = new URLSearchParams({ module });
  if (kind) params.set("kind", kind);
  return `/reports?${params}`;
}
