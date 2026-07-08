import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  exportToGoogleDocs,
  exportToGoogleDriveFile,
  ensureGoogleDocsAccessToken,
  GoogleDocsCredentialsError,
  loadGoogleDocsConnection,
} from "../google-docs-export.js";
import {
  canonicalReportFilename,
  renderCanonicalForExport,
  renderCanonicalReport,
  renderReportDownloadArtifacts,
  renderReportsForExport,
  renderWeeklyReport,
  reportFilename,
} from "../report-render.js";
import { saveReportToWhomeDrive } from "../report-drive-save.js";
import { isHouseholdModuleEnabled } from "../household-modules.js";
import type { CanonicalReport } from "./types.js";
import type { ReportExportDestination, ReportRenderFormat } from "./types.js";
import { moduleLabelForDrive } from "./build.js";
import { weeklyToCanonical } from "./adapters.js";
import type { WeeklyReportData } from "../weekly-reports/types.js";

function posterLabel(auth: {
  name?: string | null;
  email?: string | null;
  username?: string | null;
}) {
  return auth.name?.trim() || auth.email || auth.username || "Member";
}

export async function executeReportExport(params: {
  db: Database;
  env: Env;
  auth: {
    householdId: string;
    userId: string;
    name?: string | null;
    email?: string | null;
    username?: string | null;
  };
  report: CanonicalReport;
  format: ReportRenderFormat;
  destination: ReportExportDestination;
}) {
  const { db, env, auth, report, format, destination } = params;

  if (destination === "preview") {
    const downloads = renderReportDownloadArtifacts(report);
    if (report.multiPart && report.parts?.length) {
      const weeklyReports = report.parts;
      const rendered = renderReportsForExport(
        weeklyReports.map((p) => weeklyFromCanonical(p)),
        format,
        report.title,
      );
      return {
        preview: {
          title: report.title,
          format,
          plainText: rendered.plainText,
          html: rendered.html,
          weekCount: weeklyReports.length,
          filenameBase: downloads.filenameBase,
          downloads: {
            csv: downloads.csv,
            json: downloads.json,
            yaml: downloads.yaml,
          },
        },
      };
    }
    const rendered = renderCanonicalForExport(report, format);
    return {
      preview: {
        title: report.title,
        format,
        plainText: rendered.plainText,
        html: rendered.html,
        weekCount: 1,
        filenameBase: downloads.filenameBase,
        downloads: {
          csv: downloads.csv,
          json: downloads.json,
          yaml: downloads.yaml,
        },
      },
    };
  }

  const exportParts: CanonicalReport[] =
    report.multiPart && report.parts?.length ? report.parts : [report];

  if (destination === "domi-ops-drive") {
    const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
    if (!driveEnabled) return { error: "drive_disabled" as const };

    const objects: { objectId: string; title: string; url: string }[] = [];
    try {
      for (const part of exportParts) {
        const rendered = renderCanonicalReport(part, format);
        const bodyBuffer =
          format === "styled"
            ? Buffer.from(rendered.html, "utf-8")
            : Buffer.from(rendered.plainText, "utf-8");
        const object = await saveReportToWhomeDrive({
          db,
          env,
          householdId: auth.householdId,
          userId: auth.userId,
          moduleLabel: moduleLabelForDrive(report.module),
          filename: canonicalReportFilename(part, format),
          body: bodyBuffer,
          mimeType: rendered.mimeType,
          createdByLabel: posterLabel(auth),
        });
        objects.push({
          objectId: object.id,
          title: object.title ?? part.title,
          url: `/drive?object=${object.id}`,
        });
      }
      return { whomeDrive: { objects } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "save_failed";
      if (msg === "quota_exceeded") return { error: "quota_exceeded" as const };
      if (msg === "file_too_large") return { error: "file_too_large" as const };
      if (msg === "s3_not_configured") return { error: "s3_not_configured" as const };
      throw e;
    }
  }

  const conn = await loadGoogleDocsConnection(db, auth.householdId, auth.userId);
  if (!conn) return { error: "google_docs_not_connected" as const };

  let accessToken: string;
  try {
    accessToken = await ensureGoogleDocsAccessToken(db, env, conn);
  } catch (e) {
    if (e instanceof GoogleDocsCredentialsError) {
      return { error: "google_docs_token_revoked" as const, message: e.message };
    }
    throw e;
  }

  if (destination === "google-docs") {
    const documents: { documentId: string; url: string; title: string }[] = [];
    for (const part of exportParts) {
      const rendered = renderCanonicalReport(part, format);
      const result = await exportToGoogleDocs({
        accessToken,
        title: part.title,
        plainText: rendered.plainText,
        html: rendered.html,
        format,
      });
      documents.push({ ...result, title: part.title });
    }
    return { googleDocs: { documents } };
  }

  if (destination === "google-drive") {
    const files: { fileId: string; url: string; title: string }[] = [];
    for (const part of exportParts) {
      const rendered = renderCanonicalReport(part, format);
      const bodyBuffer =
        format === "styled"
          ? Buffer.from(rendered.html, "utf-8")
          : Buffer.from(rendered.plainText, "utf-8");
      const result = await exportToGoogleDriveFile({
        accessToken,
        filename: canonicalReportFilename(part, format),
        mimeType: rendered.mimeType,
        body: bodyBuffer,
      });
      files.push({ fileId: result.fileId, url: result.url, title: part.title });
    }
    return { googleDrive: { files } };
  }

  return { error: "invalid_destination" as const };
}

/** Reconstruct WeeklyReportData from canonical weekly part for combined preview. */
function weeklyFromCanonical(report: CanonicalReport): WeeklyReportData {
  const section = report.sections[0];
  const groups = section?.groups ?? [];
  const totalItems = groups.reduce(
    (sum, g) => sum + g.items.length + (g.subgroups?.reduce((s, sg) => s + sg.items.length, 0) ?? 0),
    0,
  );
  return {
    module: report.module as WeeklyReportData["module"],
    variant: "by-subject",
    variantLabel: "",
    title: report.title,
    weekStart: section?.key ?? "",
    weekEnd: "",
    weekLabel: section?.label ?? "",
    timezone: report.timezone ?? "UTC",
    groups,
    totalItems,
  };
}

/** Legacy helper for weekly-only export paths still using WeeklyReportData[]. */
export async function executeWeeklyExport(params: {
  db: Database;
  env: Env;
  auth: {
    householdId: string;
    userId: string;
    name?: string | null;
    email?: string | null;
    username?: string | null;
  };
  reports: WeeklyReportData[];
  combinedTitle: string;
  module: import("../weekly-reports/types.js").WeeklyReportModule;
  format: ReportRenderFormat;
  destination: ReportExportDestination;
}) {
  const canonical =
    params.reports.length <= 1 && params.reports[0]
      ? weeklyToCanonical(params.reports[0])
      : {
          title: params.combinedTitle,
          module: params.module,
          kind: "weekly" as const,
          generatedAt: new Date().toISOString(),
          timezone: params.reports[0]?.timezone,
          multiPart: params.reports.length > 1,
          parts: params.reports.map((r) => weeklyToCanonical(r)),
          sections: params.reports.map((r) => ({
            key: r.weekStart,
            label: `Week of ${r.weekLabel}`,
            groups: r.groups,
          })),
        };

  return executeReportExport({
    db: params.db,
    env: params.env,
    auth: params.auth,
    report: canonical,
    format: params.format,
    destination: params.destination,
  });
}

export { reportFilename, renderWeeklyReport };
