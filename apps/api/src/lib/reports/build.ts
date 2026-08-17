import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdMembers, users } from "@domi-ops/db";
import { MAX_WEEKS_IN_RANGE } from "@domi-ops/calendar-sync";
import { eq, and } from "drizzle-orm";
import { memberShownLabel } from "@domi-ops/auth";
import { buildChoreReports } from "../chores-karma.js";
import { buildExpenseReports } from "../expenses.js";
import { buildHealthReports } from "../health-reports.js";
import { isHouseholdModuleEnabled } from "../household-modules.js";
import { buildShoppingReports } from "../shopping.js";
import { buildSchoolReports, canViewSchoolReports } from "../school-reports.js";
import { memberEnrollmentsForHousehold, schoolContextForAuth } from "../school-auth-context.js";
import {
  buildWeeklyReport,
  buildWeeklyReportsInRange,
  WEEKLY_REPORT_VARIANTS,
} from "../weekly-reports/index.js";
import { weeklyReportTitle, weeklyVariantLabel } from "../weekly-reports/types.js";
import type { WeeklyReportModule } from "../weekly-reports/types.js";
import {
  choresOverviewToCanonical,
  expensesOverviewToCanonical,
  healthOverviewToCanonical,
  healthMedicationsToCanonical,
  healthTodayToCanonical,
  healthMedicationListToCanonical,
  schoolGradesToCanonical,
  schoolOpenWorkToCanonical,
  schoolTranscriptToCanonical,
  shoppingOverviewToCanonical,
  weeklyRangeToCanonical,
  weeklyToCanonical,
} from "./adapters.js";
import type { CanonicalReport, ReportCatalogEntry, ReportKind, ReportModule } from "./types.js";
import { REPORT_KIND_LABELS, REPORT_MODULE_LABELS, HEALTH_REPORT_KINDS } from "./types.js";

export interface ReportQueryParams {
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
  medicationId?: string | null;
  scheduleKind?: string | null;
}

export type ExportScope =
  | { mode: "week"; weekStart: string | null }
  | { mode: "range"; from: string; to: string };

export function parseExportScope(body: {
  weekStart?: string | null;
  from?: string | null;
  to?: string | null;
}): ExportScope | { error: string } {
  const from = body.from?.trim();
  const to = body.to?.trim();
  if (from && to) {
    if (from > to) return { error: "invalid_date_range" };
    return { mode: "range", from, to };
  }
  if (from || to) return { error: "from_and_to_required" };
  return { mode: "week", weekStart: body.weekStart?.trim() || null };
}

export async function moduleEnabledForReports(
  db: Database,
  env: Env,
  householdId: string,
  module: ReportModule,
): Promise<boolean> {
  if (module === "school") return isHouseholdModuleEnabled(db, env, householdId, "school");
  if (module === "health") return isHouseholdModuleEnabled(db, env, householdId, "health");
  return isHouseholdModuleEnabled(db, env, householdId, "core");
}

export async function authorizeSchoolReports(
  db: Database,
  householdId: string,
  userId: string,
): Promise<boolean> {
  const context = await schoolContextForAuth(db, { householdId, userId });
  return Boolean(context && canViewSchoolReports(context.viewMode, context.householdRole));
}

async function loadSchoolReportsData(
  db: Database,
  auth: { householdId: string; userId: string },
  termFilter?: string | null,
) {
  const context = await schoolContextForAuth(db, auth);
  if (!context) return null;

  const [hm] = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(eq(householdMembers.householdId, auth.householdId), eq(householdMembers.userId, auth.userId)),
    )
    .limit(1);
  if (!hm) return null;

  const enrollments = await memberEnrollmentsForHousehold(db, auth.householdId, hm.id);
  const memberRows = await db
    .select({
      id: householdMembers.id,
      name: householdMembers.name,
      legacyDisplayName: householdMembers.legacyDisplayName,
      email: users.email,
    })
    .from(householdMembers)
    .innerJoin(users, eq(householdMembers.userId, users.id))
    .where(eq(householdMembers.householdId, auth.householdId));

  const memberLabels = new Map(memberRows.map((m) => [m.id, memberShownLabel(m)]));

  return buildSchoolReports({
    db,
    householdId: auth.householdId,
    memberId: context.memberId,
    householdRole: context.householdRole,
    viewMode: context.viewMode,
    enrollments,
    memberLabels,
    termFilter,
  });
}

export async function buildCanonicalReport(
  db: Database,
  env: Env,
  auth: { householdId: string; userId: string; memberId?: string; role?: string },
  params: ReportQueryParams,
): Promise<CanonicalReport | null> {
  const { module, kind } = params;

  if (kind === "weekly") {
    const weeklyModule = module as WeeklyReportModule;
    if (!WEEKLY_REPORT_VARIANTS[weeklyModule]) return null;
    const variant = params.variant?.trim();
    if (!variant || !WEEKLY_REPORT_VARIANTS[weeklyModule].some((v) => v.id === variant)) {
      throw new Error("invalid_variant");
    }

    const from = params.from?.trim();
    const to = params.to?.trim();
    if (from && to) {
      const { reports, rangeLabel, weekCount } = await buildWeeklyReportsInRange({
        db,
        householdId: auth.householdId,
        userId: auth.userId,
        module: weeklyModule,
        variant,
        from,
        to,
      });
      if (weekCount > MAX_WEEKS_IN_RANGE) throw new Error("range_too_many_weeks");
      if (reports.length === 0) return null;
      const combinedTitle = weeklyReportTitle(
        weeklyModule,
        weeklyVariantLabel(variant, "range", weeklyModule),
        rangeLabel,
      );
      return weeklyRangeToCanonical(reports, combinedTitle, module);
    }

    const report = await buildWeeklyReport({
      db,
      householdId: auth.householdId,
      userId: auth.userId,
      module: weeklyModule,
      variant,
      weekStart: params.weekStart?.trim() || null,
    });
    return report ? weeklyToCanonical(report) : null;
  }

  if (module === "health") {
    const isToday = kind === "medications-today";
    const isList = kind === "medication-list";
    if (
      kind !== "overview" &&
      kind !== "medications" &&
      !isToday &&
      !isList
    ) {
      return null;
    }
    const toDefault = params.to?.trim() || new Date().toISOString().slice(0, 10);
    const fromDefaultDate = new Date(`${toDefault}T12:00:00.000Z`);
    fromDefaultDate.setUTCDate(fromDefaultDate.getUTCDate() - 30);
    let from = params.from?.trim() || fromDefaultDate.toISOString().slice(0, 10);
    let to = toDefault;
    if (isToday || isList) {
      // Today + medication list are point-in-time; clamp the log window to one local day.
      to = params.to?.trim() || toDefault;
      from = isToday ? to : from;
    }
    const data = await buildHealthReports(
      db,
      env,
      {
        householdId: auth.householdId,
        userId: auth.userId,
        memberId: auth.memberId ?? "",
        role: auth.role ?? "member",
      },
      from,
      to,
      {
        memberId: params.memberId,
        eventType: kind === "overview" ? params.eventType : null,
        groupBy: params.groupBy,
        medicationId: kind === "overview" || isList ? null : params.medicationId,
        scheduleKind: kind === "overview" || isList ? null : params.scheduleKind,
        pinToToday: isToday,
      },
    );
    if (kind === "medications") return healthMedicationsToCanonical(data);
    if (kind === "medications-today") return healthTodayToCanonical(data);
    if (kind === "medication-list") return healthMedicationListToCanonical(data);
    return healthOverviewToCanonical(data);
  }

  if (module === "chores" && kind === "overview") {
    const to = params.to?.trim() || new Date().toISOString().slice(0, 10);
    const fromDefault = new Date(`${to}T12:00:00.000Z`);
    fromDefault.setUTCDate(fromDefault.getUTCDate() - 30);
    const from = params.from?.trim() || fromDefault.toISOString().slice(0, 10);
    const data = await buildChoreReports(db, auth.householdId, from, to);
    return choresOverviewToCanonical(data);
  }

  if (module === "shopping" && kind === "overview") {
    const to = params.to?.trim() || new Date().toISOString().slice(0, 10);
    const fromDefault = new Date(`${to}T12:00:00.000Z`);
    fromDefault.setUTCDate(fromDefault.getUTCDate() - 30);
    const from = params.from?.trim() || fromDefault.toISOString().slice(0, 10);
    const data = await buildShoppingReports(db, auth.householdId, from, to);
    return shoppingOverviewToCanonical(data);
  }

  if (module === "expenses" && kind === "overview") {
    const month = params.month?.trim() || undefined;
    const data = await buildExpenseReports(db, auth.householdId, month);
    return expensesOverviewToCanonical(data);
  }

  if (module === "school") {
    const schoolData = await loadSchoolReportsData(db, auth, params.term);
    if (!schoolData) return null;
    if (kind === "school-grades") return schoolGradesToCanonical(schoolData);
    if (kind === "school-open-work") return schoolOpenWorkToCanonical(schoolData);
    if (kind === "school-transcript") {
      return schoolTranscriptToCanonical(schoolData, params.studentMemberId ?? undefined);
    }
  }

  return null;
}

const MODULE_KINDS: Record<ReportModule, ReportKind[]> = {
  school: ["weekly", "school-grades", "school-open-work", "school-transcript"],
  chores: ["weekly", "overview"],
  shopping: ["weekly", "overview"],
  expenses: ["weekly", "overview"],
  health: ["overview", "medications-today", "medications", "medication-list"],
};

export async function buildReportCatalog(
  db: Database,
  env: Env,
  auth: { householdId: string; userId: string },
): Promise<ReportCatalogEntry[]> {
  const entries: ReportCatalogEntry[] = [];

  for (const module of Object.keys(MODULE_KINDS) as ReportModule[]) {
    const enabled = await moduleEnabledForReports(db, env, auth.householdId, module);
    if (!enabled) continue;
    if (module === "school" && !(await authorizeSchoolReports(db, auth.householdId, auth.userId))) {
      continue;
    }

    const kinds =
      module === "health"
        ? HEALTH_REPORT_KINDS
        : MODULE_KINDS[module].map((id) => ({
            id,
            label: REPORT_KIND_LABELS[id],
          }));

    entries.push({
      module,
      moduleLabel: REPORT_MODULE_LABELS[module],
      kinds,
    });
  }

  return entries;
}

export function moduleLabelForDrive(module: ReportModule): string {
  return REPORT_MODULE_LABELS[module];
}
