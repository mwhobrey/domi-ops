import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { MAX_WEEKS_IN_RANGE } from "@domi-ops/calendar-sync";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { isHouseholdModuleEnabled } from "../lib/household-modules.js";
import { canViewSchoolReports } from "../lib/school-reports.js";
import { schoolContextForAuth } from "../lib/school-auth-context.js";
import {
  exportToGoogleDocs,
  exportToGoogleDriveFile,
  ensureGoogleDocsAccessToken,
  GoogleDocsCredentialsError,
  loadGoogleDocsConnection,
} from "../lib/google-docs-export.js";
import {
  renderReportsForExport,
  renderWeeklyReport,
  reportFilename,
} from "../lib/report-render.js";
import { saveReportToWhomeDrive } from "../lib/report-drive-save.js";
import {
  buildWeeklyReport,
  buildWeeklyReportsInRange,
  WEEKLY_REPORT_VARIANTS,
  type ReportExportDestination,
  type ReportRenderFormat,
  type WeeklyReportData,
  type WeeklyReportModule,
} from "../lib/weekly-reports/index.js";
import { weeklyReportTitle, weeklyVariantLabel } from "../lib/weekly-reports/types.js";

function posterLabel(auth: { name?: string | null; email?: string | null; username?: string | null }) {
  return auth.name?.trim() || auth.email || auth.username || "Member";
}

type ExportScope =
  | { mode: "week"; weekStart: string | null }
  | { mode: "range"; from: string; to: string };

function parseExportScope(body: {
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

async function authorizeSchool(
  db: Database,
  householdId: string,
  userId: string,
): Promise<boolean> {
  const context = await schoolContextForAuth(db, { householdId, userId });
  return Boolean(context && canViewSchoolReports(context.viewMode, context.householdRole));
}

async function loadReportsForScope(
  db: Database,
  auth: { householdId: string; userId: string },
  module: WeeklyReportModule,
  variant: string,
  scope: ExportScope,
): Promise<{ reports: WeeklyReportData[]; combinedTitle: string } | null> {
  if (scope.mode === "week") {
    const report = await buildWeeklyReport({
      db,
      householdId: auth.householdId,
      userId: auth.userId,
      module,
      variant,
      weekStart: scope.weekStart,
    });
    if (!report) return null;
    return { reports: [report], combinedTitle: report.title };
  }

  const { reports, rangeLabel, weekCount } = await buildWeeklyReportsInRange({
    db,
    householdId: auth.householdId,
    userId: auth.userId,
    module,
    variant,
    from: scope.from,
    to: scope.to,
  });
  if (weekCount > MAX_WEEKS_IN_RANGE) {
    throw new Error("range_too_many_weeks");
  }
  const combinedTitle = weeklyReportTitle(
    module,
    weeklyVariantLabel(variant, "range", module),
    rangeLabel,
  );
  return { reports, combinedTitle };
}

export function weeklyReportRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/weekly-reports/variants", (c) => c.json({ variants: WEEKLY_REPORT_VARIANTS }));

  app.get("/weekly-reports", async (c) => {
    const auth = c.get("auth")!;
    const module = c.req.query("module") as WeeklyReportModule | undefined;
    const variant = c.req.query("variant")?.trim();
    const from = c.req.query("from")?.trim();
    const to = c.req.query("to")?.trim();
    const weekStart = c.req.query("weekStart")?.trim() || null;

    if (!module || !variant) return c.json({ error: "module_and_variant_required" }, 400);
    if (!WEEKLY_REPORT_VARIANTS[module]) return c.json({ error: "invalid_module" }, 400);
    if ((from && !to) || (!from && to)) return c.json({ error: "from_and_to_required" }, 400);
    if (from && to && from > to) return c.json({ error: "invalid_date_range" }, 400);

    const moduleOk = await moduleEnabled(db, env, auth.householdId, module);
    if (!moduleOk) return c.json({ error: "module_disabled" }, 403);

    if (module === "school" && !(await authorizeSchool(db, auth.householdId, auth.userId))) {
      return c.json({ error: "forbidden" }, 403);
    }

    try {
      if (from && to) {
        const result = await buildWeeklyReportsInRange({
          db,
          householdId: auth.householdId,
          userId: auth.userId,
          module,
          variant,
          from,
          to,
        });
        if (result.weekCount > MAX_WEEKS_IN_RANGE) {
          return c.json({ error: "range_too_many_weeks", maxWeeks: MAX_WEEKS_IN_RANGE }, 400);
        }
        return c.json({
          mode: "range" as const,
          from,
          to,
          rangeLabel: result.rangeLabel,
          weekCount: result.weekCount,
          reports: result.reports,
        });
      }

      const report = await buildWeeklyReport({
        db,
        householdId: auth.householdId,
        userId: auth.userId,
        module,
        variant,
        weekStart,
      });
      if (!report) return c.json({ error: "not_found" }, 404);
      return c.json({ mode: "week" as const, report });
    } catch (e) {
      if (e instanceof Error && e.message === "invalid_variant") {
        return c.json({ error: "invalid_variant" }, 400);
      }
      throw e;
    }
  });

  app.get("/weekly-reports/google-docs/status", async (c) => {
    const auth = c.get("auth")!;
    const conn = await loadGoogleDocsConnection(db, auth.householdId, auth.userId);
    return c.json({
      connected: Boolean(conn),
      connectUrl: "/auth/google/docs/start",
    });
  });

  app.post("/weekly-reports/export", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      module?: WeeklyReportModule;
      variant?: string;
      weekStart?: string | null;
      from?: string | null;
      to?: string | null;
      format?: ReportRenderFormat;
      destination?: ReportExportDestination;
    }>();

    const module = body.module;
    const variant = body.variant?.trim();
    const format: ReportRenderFormat = body.format === "styled" ? "styled" : "plain";
    const destination: ReportExportDestination = body.destination ?? "preview";

    if (!module || !variant) return c.json({ error: "module_and_variant_required" }, 400);
    if (!WEEKLY_REPORT_VARIANTS[module]) return c.json({ error: "invalid_module" }, 400);

    const scope = parseExportScope(body);
    if ("error" in scope) return c.json({ error: scope.error }, 400);

    const moduleOk = await moduleEnabled(db, env, auth.householdId, module);
    if (!moduleOk) return c.json({ error: "module_disabled" }, 403);

    if (module === "school" && !(await authorizeSchool(db, auth.householdId, auth.userId))) {
      return c.json({ error: "forbidden" }, 403);
    }

    let loaded;
    try {
      loaded = await loadReportsForScope(db, auth, module, variant, scope);
    } catch (e) {
      if (e instanceof Error && e.message === "range_too_many_weeks") {
        return c.json({ error: "range_too_many_weeks", maxWeeks: MAX_WEEKS_IN_RANGE }, 400);
      }
      if (e instanceof Error && e.message === "invalid_variant") {
        return c.json({ error: "invalid_variant" }, 400);
      }
      throw e;
    }
    if (!loaded || loaded.reports.length === 0) return c.json({ error: "not_found" }, 404);

    const { reports, combinedTitle } = loaded;
    const isRange = scope.mode === "range" && reports.length > 1;

    if (destination === "preview") {
      const rendered = renderReportsForExport(reports, format, combinedTitle);
      return c.json({
        preview: {
          title: combinedTitle,
          format,
          plainText: rendered.plainText,
          html: rendered.html,
          weekCount: reports.length,
        },
      });
    }

    if (destination === "domi-ops-drive") {
      const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
      if (!driveEnabled) return c.json({ error: "drive_disabled" }, 403);

      const objects: { objectId: string; title: string; url: string }[] = [];
      try {
        if (isRange) {
          for (const report of reports) {
            const rendered = renderWeeklyReport(report, format);
            const bodyBuffer =
              format === "styled"
                ? Buffer.from(rendered.html, "utf-8")
                : Buffer.from(rendered.plainText, "utf-8");
            const object = await saveReportToWhomeDrive({
              db,
              env,
              householdId: auth.householdId,
              userId: auth.userId,
              moduleLabel: moduleLabel(module),
              filename: reportFilename(report, format),
              body: bodyBuffer,
              mimeType: rendered.mimeType,
              createdByLabel: posterLabel(auth),
            });
            objects.push({
              objectId: object.id,
              title: object.title ?? report.title,
              url: `/drive?object=${object.id}`,
            });
          }
        } else {
          const report = reports[0]!;
          const rendered = renderWeeklyReport(report, format);
          const bodyBuffer =
            format === "styled"
              ? Buffer.from(rendered.html, "utf-8")
              : Buffer.from(rendered.plainText, "utf-8");
          const object = await saveReportToWhomeDrive({
            db,
            env,
            householdId: auth.householdId,
            userId: auth.userId,
            moduleLabel: moduleLabel(module),
            filename: reportFilename(report, format),
            body: bodyBuffer,
            mimeType: rendered.mimeType,
            createdByLabel: posterLabel(auth),
          });
          objects.push({
            objectId: object.id,
            title: object.title ?? report.title,
            url: `/drive?object=${object.id}`,
          });
        }
        return c.json({ whomeDrive: { objects } });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "save_failed";
        if (msg === "quota_exceeded") return c.json({ error: "quota_exceeded" }, 400);
        if (msg === "file_too_large") return c.json({ error: "file_too_large" }, 400);
        if (msg === "s3_not_configured") return c.json({ error: "s3_not_configured" }, 503);
        throw e;
      }
    }

    const conn = await loadGoogleDocsConnection(db, auth.householdId, auth.userId);
    if (!conn) return c.json({ error: "google_docs_not_connected" }, 403);

    let accessToken: string;
    try {
      accessToken = await ensureGoogleDocsAccessToken(db, env, conn);
    } catch (e) {
      if (e instanceof GoogleDocsCredentialsError) {
        return c.json({ error: "google_docs_token_revoked", message: e.message }, 403);
      }
      throw e;
    }

    if (destination === "google-docs") {
      const documents: { documentId: string; url: string; title: string }[] = [];
      for (const report of reports) {
        const rendered = renderWeeklyReport(report, format);
        const result = await exportToGoogleDocs({
          accessToken,
          title: report.title,
          plainText: rendered.plainText,
          html: rendered.html,
          format,
        });
        documents.push({ ...result, title: report.title });
      }
      return c.json({ googleDocs: { documents } });
    }

    if (destination === "google-drive") {
      const files: { fileId: string; url: string; title: string }[] = [];
      for (const report of reports) {
        const rendered = renderWeeklyReport(report, format);
        const bodyBuffer =
          format === "styled"
            ? Buffer.from(rendered.html, "utf-8")
            : Buffer.from(rendered.plainText, "utf-8");
        const result = await exportToGoogleDriveFile({
          accessToken,
          filename: reportFilename(report, format),
          mimeType: rendered.mimeType,
          body: bodyBuffer,
        });
        files.push({ fileId: result.fileId, url: result.url, title: report.title });
      }
      return c.json({ googleDrive: { files } });
    }

    return c.json({ error: "invalid_destination" }, 400);
  });

  return app;
}

async function moduleEnabled(
  db: Database,
  env: Env,
  householdId: string,
  module: WeeklyReportModule,
): Promise<boolean> {
  if (module === "school") return isHouseholdModuleEnabled(db, env, householdId, "school");
  return isHouseholdModuleEnabled(db, env, householdId, "core");
}

function moduleLabel(module: WeeklyReportModule): string {
  switch (module) {
    case "school":
      return "School";
    case "chores":
      return "Chores";
    case "shopping":
      return "Shopping";
    case "expenses":
      return "Expenses";
  }
}
