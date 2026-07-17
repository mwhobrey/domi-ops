import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import { googlePickerAppId } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { MAX_WEEKS_IN_RANGE } from "@domi-ops/calendar-sync";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import {
  ensureGoogleDocsAccessToken,
  GoogleDocsCredentialsError,
  loadGoogleDocsConnection,
} from "../lib/google-docs-export.js";
import {
  authorizeSchoolReports,
  buildCanonicalReport,
  buildReportCatalog,
  executeReportExport,
  moduleEnabledForReports,
  parseExportScope,
  type ReportKind,
  type ReportModule,
  type ReportExportDestination,
  type ReportRenderFormat,
} from "../lib/reports/index.js";

export function reportRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/reports/catalog", async (c) => {
    const auth = c.get("auth")!;
    const catalog = await buildReportCatalog(db, env, auth);
    return c.json({ catalog });
  });

  app.get("/reports/google-docs/status", async (c) => {
    const auth = c.get("auth")!;
    const conn = await loadGoogleDocsConnection(db, auth.householdId, auth.userId);
    return c.json({
      connected: Boolean(conn),
      connectUrl: "/auth/google/docs/start",
    });
  });

  app.get("/google/docs/picker-session", async (c) => {
    const auth = c.get("auth")!;
    if (!env.GOOGLE_PICKER_API_KEY || !env.GOOGLE_OAUTH_CLIENT_ID) {
      return c.json({ error: "picker_not_configured" }, 503);
    }

    const appId = googlePickerAppId({
      projectNumber: env.GOOGLE_CLOUD_PROJECT_NUMBER,
      oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID,
    });
    if (!appId) {
      return c.json({ error: "picker_app_id_invalid" }, 503);
    }

    const conn = await loadGoogleDocsConnection(db, auth.householdId, auth.userId);
    const next = c.req.query("next");
    const connectUrl = next
      ? `/auth/google/docs/start?next=${encodeURIComponent(next)}`
      : "/auth/google/docs/start";

    if (!conn) {
      return c.json({ connected: false, connectUrl }, 403);
    }

    try {
      const accessToken = await ensureGoogleDocsAccessToken(db, env, conn);
      return c.json({
        connected: true,
        connectUrl,
        accessToken,
        developerKey: env.GOOGLE_PICKER_API_KEY,
        appId,
      });
    } catch (e) {
      if (e instanceof GoogleDocsCredentialsError) {
        return c.json(
          { error: "google_docs_token_revoked", message: e.message, connected: false, connectUrl },
          403,
        );
      }
      throw e;
    }
  });

  app.get("/reports", async (c) => {
    const auth = c.get("auth")!;
    const module = c.req.query("module") as ReportModule | undefined;
    const kind = (c.req.query("kind") as ReportKind | undefined) ?? "overview";

    if (!module) return c.json({ error: "module_required" }, 400);

    const moduleOk = await moduleEnabledForReports(db, env, auth.householdId, module);
    if (!moduleOk) return c.json({ error: "module_disabled" }, 403);

    if (module === "school" && !(await authorizeSchoolReports(db, auth.householdId, auth.userId))) {
      return c.json({ error: "forbidden" }, 403);
    }

    try {
      const report = await buildCanonicalReport(db, env, auth, {
        module,
        kind,
        variant: c.req.query("variant")?.trim(),
        weekStart: c.req.query("weekStart")?.trim() || null,
        from: c.req.query("from")?.trim() || null,
        to: c.req.query("to")?.trim() || null,
        month: c.req.query("month")?.trim() || null,
        term: c.req.query("term")?.trim() || null,
        studentMemberId: c.req.query("studentMemberId")?.trim() || null,
        memberId: c.req.query("memberId")?.trim() || null,
        eventType: c.req.query("eventType")?.trim() || null,
        groupBy: c.req.query("groupBy")?.trim() || null,
      });
      if (!report) return c.json({ error: "not_found" }, 404);
      return c.json({ report });
    } catch (e) {
      if (e instanceof Error && e.message === "invalid_variant") {
        return c.json({ error: "invalid_variant" }, 400);
      }
      if (e instanceof Error && e.message === "range_too_many_weeks") {
        return c.json({ error: "range_too_many_weeks", maxWeeks: MAX_WEEKS_IN_RANGE }, 400);
      }
      throw e;
    }
  });

  app.post("/reports/export", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      module?: ReportModule;
      kind?: ReportKind;
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
      format?: ReportRenderFormat;
      destination?: ReportExportDestination;
    }>();

    const module = body.module;
    const kind = body.kind ?? (body.variant ? "weekly" : "overview");
    const format: ReportRenderFormat = body.format === "styled" ? "styled" : "plain";
    const destination: ReportExportDestination = body.destination ?? "preview";

    if (!module) return c.json({ error: "module_required" }, 400);

    const moduleOk = await moduleEnabledForReports(db, env, auth.householdId, module);
    if (!moduleOk) return c.json({ error: "module_disabled" }, 403);

    if (module === "school" && !(await authorizeSchoolReports(db, auth.householdId, auth.userId))) {
      return c.json({ error: "forbidden" }, 403);
    }

    if (kind === "weekly") {
      const scope = parseExportScope(body);
      if ("error" in scope) return c.json({ error: scope.error }, 400);
      if (!body.variant?.trim()) return c.json({ error: "variant_required" }, 400);
    }

    let report;
    try {
      report = await buildCanonicalReport(db, env, auth, {
        module,
        kind,
        variant: body.variant?.trim(),
        weekStart: body.weekStart,
        from: body.from,
        to: body.to,
        month: body.month,
        term: body.term,
        studentMemberId: body.studentMemberId,
        memberId: body.memberId,
        eventType: body.eventType,
        groupBy: body.groupBy,
      });
    } catch (e) {
      if (e instanceof Error && e.message === "range_too_many_weeks") {
        return c.json({ error: "range_too_many_weeks", maxWeeks: MAX_WEEKS_IN_RANGE }, 400);
      }
      if (e instanceof Error && e.message === "invalid_variant") {
        return c.json({ error: "invalid_variant" }, 400);
      }
      throw e;
    }

    if (!report) return c.json({ error: "not_found" }, 404);

    const result = await executeReportExport({
      db,
      env,
      auth,
      report,
      format,
      destination,
    });

    if ("error" in result) {
      if (result.error === "google_docs_token_revoked") {
        return c.json({ error: result.error, message: result.message }, 403);
      }
      const status =
        result.error === "drive_disabled" || result.error === "google_docs_not_connected"
          ? 403
          : result.error === "s3_not_configured"
            ? 503
            : result.error === "quota_exceeded" || result.error === "file_too_large"
              ? 400
              : 400;
      return c.json({ error: result.error }, status);
    }

    return c.json(result);
  });

  return app;
}
