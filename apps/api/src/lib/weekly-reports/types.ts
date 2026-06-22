export type WeeklyReportModule = "school" | "chores" | "shopping" | "expenses";

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
  /** Nested groups (e.g. week → day in range exports). */
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

export type ReportRenderFormat = "plain" | "styled";

export type ReportExportDestination =
  | "preview"
  | "whome-drive"
  | "google-docs"
  | "google-drive";

export const WEEKLY_REPORT_VARIANTS: Record<
  WeeklyReportModule,
  { id: string; label: string }[]
> = {
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

export function weeklyVariantLabel(
  variant: string,
  scope: "week" | "range",
  module: WeeklyReportModule,
): string {
  if (variant === "by-day") {
    return scope === "range" ? "By week & day" : "By day";
  }
  const found = WEEKLY_REPORT_VARIANTS[module].find((v) => v.id === variant);
  return found?.label ?? variant;
}

export function weeklyReportTitle(module: WeeklyReportModule, variantLabel: string, weekLabel: string): string {
  const moduleLabel =
    module === "school"
      ? "School"
      : module === "chores"
        ? "Chores"
        : module === "shopping"
          ? "Shopping"
          : "Expenses";
  return `${moduleLabel} weekly schedule (${variantLabel}) — ${weekLabel}`;
}
