import type { Database } from "@domi-ops/db";
import { weeksOverlappingRange } from "@domi-ops/calendar-sync";
import { buildChoresWeeklyReport, buildShoppingWeeklyReport } from "./chores-shopping.js";
import { buildExpensesWeeklyReport } from "./expenses.js";
import { resolveMonFriWeek } from "./helpers.js";
import { buildSchoolWeeklyReport } from "./school.js";
import type { WeeklyReportData, WeeklyReportModule } from "./types.js";
import { WEEKLY_REPORT_VARIANTS } from "./types.js";

export async function buildWeeklyReportsInRange(params: {
  db: Database;
  householdId: string;
  userId: string;
  module: WeeklyReportModule;
  variant: string;
  from: string;
  to: string;
}): Promise<{ reports: WeeklyReportData[]; weekCount: number; rangeLabel: string }> {
  const { timezone } = await resolveMonFriWeek(params.db, params.householdId);
  const weeks = weeksOverlappingRange(params.from, params.to, timezone);
  const reports: WeeklyReportData[] = [];
  for (const w of weeks) {
    const report = await buildWeeklyReport({
      db: params.db,
      householdId: params.householdId,
      userId: params.userId,
      module: params.module,
      variant: params.variant,
      weekStart: w.weekStart,
      scope: "range",
    });
    if (report) reports.push(report);
  }
  const rangeLabel =
    reports.length === 0
      ? `${params.from} – ${params.to}`
      : reports.length === 1
        ? reports[0]!.weekLabel
        : `${reports[0]!.weekLabel} – ${reports[reports.length - 1]!.weekLabel}`;
  return { reports, weekCount: reports.length, rangeLabel };
}

export async function buildWeeklyReport(params: {
  db: Database;
  householdId: string;
  userId: string;
  module: WeeklyReportModule;
  variant: string;
  weekStart?: string | null;
  scope?: "week" | "range";
}): Promise<WeeklyReportData | null> {
  const allowed = WEEKLY_REPORT_VARIANTS[params.module].map((v) => v.id);
  if (!allowed.includes(params.variant)) {
    throw new Error("invalid_variant");
  }

  const scope = params.scope ?? "week";

  switch (params.module) {
    case "school":
      return buildSchoolWeeklyReport({
        db: params.db,
        householdId: params.householdId,
        userId: params.userId,
        variant: params.variant as "by-subject" | "by-class" | "by-day",
        weekStart: params.weekStart,
        scope,
      });
    case "chores":
      return buildChoresWeeklyReport({
        db: params.db,
        householdId: params.householdId,
        variant: params.variant as "by-list" | "by-assignee" | "by-day",
        weekStart: params.weekStart,
        scope,
      });
    case "shopping":
      return buildShoppingWeeklyReport({
        db: params.db,
        householdId: params.householdId,
        variant: params.variant as "by-aisle" | "by-item" | "by-day",
        weekStart: params.weekStart,
        scope,
      });
    case "expenses":
      return buildExpensesWeeklyReport({
        db: params.db,
        householdId: params.householdId,
        variant: params.variant as "by-category" | "by-day",
        weekStart: params.weekStart,
        scope,
      });
    default:
      return null;
  }
}

export * from "./types.js";
