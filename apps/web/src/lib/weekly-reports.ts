export type WeeklyReportModule = "school" | "chores" | "shopping" | "expenses";

export type ReportRenderFormat = "plain" | "styled";

export type ReportExportDestination =
  | "preview"
  | "domi-ops-drive"
  | "google-docs"
  | "google-drive";

export interface WeeklyReportItem {
  id: string;
  title: string;
  subtitle?: string | null;
  dueDate: string | null;
  dueLabel?: string | null;
}

export interface WeeklyReportGroup {
  key: string;
  label: string;
  items: WeeklyReportItem[];
  subgroups?: WeeklyReportGroup[];
}

export interface WeeklyReportData {
  module: WeeklyReportModule;
  variant: string;
  variantLabel: string;
  title: string;
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  timezone: string;
  groups: WeeklyReportGroup[];
  totalItems: number;
}

export interface WeeklyReportVariant {
  id: string;
  label: string;
}

export const WEEKLY_REPORT_VARIANTS: Record<WeeklyReportModule, WeeklyReportVariant[]> = {
  school: [
    { id: "by-subject", label: "By subject" },
    { id: "by-class", label: "By class" },
    { id: "by-day", label: "By day" },
  ],
  chores: [
    { id: "by-list", label: "By list" },
    { id: "by-assignee", label: "By assignee" },
    { id: "by-day", label: "By day" },
  ],
  shopping: [
    { id: "by-aisle", label: "By aisle" },
    { id: "by-item", label: "By item" },
    { id: "by-day", label: "By day" },
  ],
  expenses: [
    { id: "by-category", label: "By category" },
    { id: "by-day", label: "By day" },
  ],
};

export function weeklyVariantOptions(
  module: WeeklyReportModule,
  scopeMode: "week" | "range",
): WeeklyReportVariant[] {
  return WEEKLY_REPORT_VARIANTS[module].map((v) =>
    v.id === "by-day" && scopeMode === "range"
      ? { ...v, label: "By week & day" }
      : v,
  );
}
