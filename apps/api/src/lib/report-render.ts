import { stringify as stringifyYaml } from "yaml";
import type { CanonicalReport, CanonicalReportSection } from "./reports/types.js";
import type { ReportRenderFormat, WeeklyReportGroup } from "./weekly-reports/types.js";
import type { WeeklyReportData } from "./weekly-reports/types.js";

function isDayGrouped(report: WeeklyReportData): boolean {
  return report.variant === "by-day";
}

function renderGroupPlain(
  group: WeeklyReportGroup,
  dayGrouped: boolean,
  indent: string,
): string[] {
  const lines: string[] = [indent + group.label];
  for (const item of group.items) {
    const due = item.dueLabel ?? item.dueDate ?? "—";
    const sub = item.subtitle ? ` (${item.subtitle})` : "";
    if (dayGrouped) {
      const amount = item.dueLabel && item.dueLabel.startsWith("$") ? ` — ${item.dueLabel}` : "";
      lines.push(`${indent}  • ${item.title}${sub}${amount}`);
    } else {
      lines.push(`${indent}  • ${item.title}${sub} — ${due}`);
    }
  }
  if (group.subgroups?.length) {
    for (const sub of group.subgroups) {
      lines.push(...renderGroupPlain(sub, dayGrouped, indent + "  "));
    }
  }
  lines.push("");
  return lines;
}

function renderGroupStyled(
  group: WeeklyReportGroup,
  dayGrouped: boolean,
  headingTag: "h2" | "h3" | "h4",
): string {
  const rows: string[] = [];
  rows.push(`<${headingTag}>${escapeHtml(group.label)}</${headingTag}>`);
  const showDue = !dayGrouped || group.items.some((i) => i.dueLabel?.startsWith("$"));
  rows.push(
    `<table><thead><tr><th>Item</th><th>Details</th>${showDue ? "<th>Due</th>" : ""}</tr></thead><tbody>`,
  );
  for (const item of group.items) {
    const dueCell = showDue
      ? `<td>${escapeHtml(item.dueLabel ?? item.dueDate ?? "—")}</td>`
      : "";
    rows.push(
      `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.subtitle ?? "")}</td>${dueCell}</tr>`,
    );
  }
  rows.push("</tbody></table>");
  if (group.subgroups?.length) {
    const childTag = headingTag === "h2" ? "h3" : "h4";
    for (const sub of group.subgroups) {
      rows.push(renderGroupStyled(sub, dayGrouped, childTag));
    }
  }
  return rows.join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderWeeklyReportPlain(report: WeeklyReportData): string {
  return renderWeeklyReportPlainSection(report, true);
}

function renderWeeklyReportPlainSection(report: WeeklyReportData, includeTitle: boolean): string {
  const dayGrouped = isDayGrouped(report);
  const lines: string[] = includeTitle ? [report.title, ""] : [`Week of ${report.weekLabel}`, ""];
  if (report.totalItems === 0) {
    lines.push("Nothing scheduled this week.");
    return lines.join("\n").trimEnd();
  }
  for (const group of report.groups) {
    lines.push(...renderGroupPlain(group, dayGrouped, ""));
  }
  return lines.join("\n").trimEnd();
}

function renderWeeklyReportStyledBody(report: WeeklyReportData): string {
  const dayGrouped = isDayGrouped(report);
  const rows: string[] = [];
  rows.push(`<h2 class="week-heading">Week of ${escapeHtml(report.weekLabel)}</h2>`);
  if (report.totalItems === 0) {
    rows.push('<p class="empty">Nothing scheduled this week.</p>');
  } else {
    for (const group of report.groups) {
      rows.push(renderGroupStyled(group, dayGrouped, "h3"));
    }
  }
  return rows.join("");
}

export function renderWeeklyReportsCombinedPlain(
  reports: WeeklyReportData[],
  title: string,
): string {
  if (reports.length === 0) return `${title}\n\nNo weeks in range.`;
  if (reports.length === 1) return renderWeeklyReportPlain(reports[0]!);
  const sections = reports.map((r, i) =>
    i === 0 ? renderWeeklyReportPlain(r) : renderWeeklyReportPlainSection(r, false),
  );
  return [title, "", ...sections].join("\n\n").trimEnd();
}

export function renderWeeklyReportsCombinedStyledHtml(
  reports: WeeklyReportData[],
  title: string,
  timezone: string,
): string {
  const rows: string[] = [];
  rows.push("<!DOCTYPE html><html><head><meta charset=\"utf-8\">");
  rows.push("<style>");
  rows.push("body{font-family:system-ui,sans-serif;color:#111827;margin:2rem;line-height:1.5}");
  rows.push("h1{font-size:1.5rem;margin:0 0 .25rem}");
  rows.push(".meta{color:#6b7280;margin:0 0 1.5rem}");
  rows.push(".week-heading{font-size:1.15rem;margin:2rem 0 .75rem;border-bottom:1px solid #e5e7eb;padding-bottom:.25rem}");
  rows.push(".week-heading:first-of-type{margin-top:0}");
  rows.push("h3{font-size:1rem;margin:1rem 0 .5rem}");
  rows.push("table{border-collapse:collapse;width:100%;margin-bottom:1rem}");
  rows.push("th,td{border:1px solid #e5e7eb;padding:.5rem .75rem;text-align:left}");
  rows.push("th{background:#f9fafb;font-weight:600}");
  rows.push("tr:nth-child(even) td{background:#fcfcfd}");
  rows.push(".empty{color:#6b7280;font-style:italic}");
  rows.push("</style></head><body>");
  rows.push(`<h1>${escapeHtml(title)}</h1>`);
  rows.push(`<p class="meta">${reports.length} week${reports.length === 1 ? "" : "s"} · ${escapeHtml(timezone)}</p>`);
  if (reports.length === 0) {
    rows.push('<p class="empty">No weeks in range.</p>');
  } else {
    for (const report of reports) {
      rows.push(renderWeeklyReportStyledBody(report));
    }
  }
  rows.push("</body></html>");
  return rows.join("");
}

export function renderWeeklyReportStyledHtml(report: WeeklyReportData): string {
  const rows: string[] = [];
  rows.push("<!DOCTYPE html><html><head><meta charset=\"utf-8\">");
  rows.push("<style>");
  rows.push("body{font-family:system-ui,sans-serif;color:#111827;margin:2rem;line-height:1.5}");
  rows.push("h1{font-size:1.5rem;margin:0 0 .25rem}");
  rows.push(".meta{color:#6b7280;margin:0 0 1.5rem}");
  rows.push("h2{font-size:1.1rem;margin:1.5rem 0 .5rem;border-bottom:1px solid #e5e7eb;padding-bottom:.25rem}");
  rows.push("table{border-collapse:collapse;width:100%;margin-bottom:1rem}");
  rows.push("th,td{border:1px solid #e5e7eb;padding:.5rem .75rem;text-align:left}");
  rows.push("th{background:#f9fafb;font-weight:600}");
  rows.push("tr:nth-child(even) td{background:#fcfcfd}");
  rows.push(".empty{color:#6b7280;font-style:italic}");
  rows.push("</style></head><body>");
  rows.push(`<h1>${escapeHtml(report.title)}</h1>`);
  rows.push(`<p class="meta">Week of ${escapeHtml(report.weekLabel)} · ${escapeHtml(report.timezone)}</p>`);

  if (report.totalItems === 0) {
    rows.push('<p class="empty">Nothing scheduled this week.</p>');
  } else {
    const dayGrouped = isDayGrouped(report);
    for (const group of report.groups) {
      rows.push(renderGroupStyled(group, dayGrouped, "h2"));
    }
  }

  rows.push("</body></html>");
  return rows.join("");
}

export function renderWeeklyReportCsv(report: WeeklyReportData): string {
  const lines = [["Group", "Item", "Details", "Due"].join(",")];
  for (const group of report.groups) {
    for (const item of group.items) {
      lines.push(
        [
          csvEscape(group.label),
          csvEscape(item.title),
          csvEscape(item.subtitle ?? ""),
          csvEscape(item.dueLabel ?? item.dueDate ?? ""),
        ].join(","),
      );
    }
  }
  return lines.join("\n");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function renderWeeklyReport(
  report: WeeklyReportData,
  format: ReportRenderFormat,
): { plainText: string; html: string; csv: string; mimeType: string; extension: string } {
  const plainText = renderWeeklyReportPlain(report);
  const html = renderWeeklyReportStyledHtml(report);
  const csv = renderWeeklyReportCsv(report);
  if (format === "plain") {
    return { plainText, html, csv, mimeType: "text/plain;charset=utf-8", extension: "txt" };
  }
  return { plainText, html, csv, mimeType: "text/html;charset=utf-8", extension: "html" };
}

export function reportFilename(report: WeeklyReportData, format: ReportRenderFormat): string {
  const slug = report.title
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  const rendered = renderWeeklyReport(report, format);
  return `${slug || "weekly-report"}.${rendered.extension}`;
}

export function rangeReportFilename(
  module: string,
  variant: string,
  rangeLabel: string,
  format: ReportRenderFormat,
): string {
  const ext = format === "styled" ? "html" : "txt";
  const slug = `${module}-${variant}-${rangeLabel}`
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return `${slug || "weekly-reports"}.${ext}`;
}

export function renderReportsForExport(
  reports: WeeklyReportData[],
  format: ReportRenderFormat,
  combinedTitle: string,
): { plainText: string; html: string; mimeType: string; extension: string } {
  const plainText =
    reports.length <= 1 && reports[0]
      ? renderWeeklyReportPlain(reports[0])
      : renderWeeklyReportsCombinedPlain(reports, combinedTitle);
  const html =
    reports.length <= 1 && reports[0]
      ? renderWeeklyReportStyledHtml(reports[0])
      : renderWeeklyReportsCombinedStyledHtml(
          reports,
          combinedTitle,
          reports[0]?.timezone ?? "UTC",
        );
  if (format === "plain") {
    return { plainText, html, mimeType: "text/plain;charset=utf-8", extension: "txt" };
  }
  return { plainText, html, mimeType: "text/html;charset=utf-8", extension: "html" };
}

function renderSectionPlain(section: CanonicalReportSection, indent: string): string[] {
  const lines: string[] = [indent + section.label];
  if (section.emptyMessage) {
    lines.push(indent + "  " + section.emptyMessage);
    lines.push("");
    return lines;
  }
  if (section.stats?.length) {
    for (const stat of section.stats) {
      lines.push(`${indent}  ${stat.label}: ${stat.value}`);
    }
    lines.push("");
  }
  for (const table of section.tables ?? []) {
    lines.push(`${indent}  ${table.label}`);
    lines.push(`${indent}    ${table.columns.join(" | ")}`);
    for (const row of table.rows) {
      lines.push(`${indent}    ${row.map((c) => String(c ?? "—")).join(" | ")}`);
    }
    lines.push("");
  }
  if (section.groups?.length) {
    const dayGrouped = false;
    for (const group of section.groups) {
      lines.push(...renderGroupPlain(group, dayGrouped, indent + "  "));
    }
  }
  return lines;
}

function renderSectionStyled(section: CanonicalReportSection, headingTag: "h2" | "h3"): string {
  const rows: string[] = [];
  rows.push(`<${headingTag}>${escapeHtml(section.label)}</${headingTag}>`);
  if (section.emptyMessage) {
    rows.push(`<p class="empty">${escapeHtml(section.emptyMessage)}</p>`);
    return rows.join("");
  }
  if (section.stats?.length) {
    rows.push('<div class="stats">');
    for (const stat of section.stats) {
      rows.push(
        `<p><strong>${escapeHtml(stat.label)}:</strong> ${escapeHtml(stat.value)}</p>`,
      );
    }
    rows.push("</div>");
  }
  for (const table of section.tables ?? []) {
    rows.push(`<h4>${escapeHtml(table.label)}</h4>`);
    rows.push(
      `<table><thead><tr>${table.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>`,
    );
    for (const row of table.rows) {
      rows.push(
        `<tr>${row.map((c) => `<td>${escapeHtml(String(c ?? "—"))}</td>`).join("")}</tr>`,
      );
    }
    rows.push("</tbody></table>");
  }
  if (section.groups?.length) {
    for (const group of section.groups) {
      rows.push(renderGroupStyled(group, group.items.some((i) => i.dueLabel?.startsWith("$")), "h4"));
    }
  }
  return rows.join("");
}

export function renderCanonicalReportPlain(report: CanonicalReport): string {
  const lines: string[] = [report.title, ""];
  if (report.timezone) lines.push(`Timezone: ${report.timezone}`, "");
  for (const section of report.sections) {
    lines.push(...renderSectionPlain(section, ""));
  }
  return lines.join("\n").trimEnd();
}

const CANONICAL_HTML_STYLES = [
  "body{font-family:system-ui,sans-serif;color:#111827;margin:2rem;line-height:1.5}",
  "h1{font-size:1.5rem;margin:0 0 .25rem}",
  ".meta{color:#6b7280;margin:0 0 1.5rem}",
  "h2{font-size:1.1rem;margin:1.5rem 0 .5rem;border-bottom:1px solid #e5e7eb;padding-bottom:.25rem}",
  "h3{font-size:1rem;margin:1rem 0 .5rem}",
  "h4{font-size:.95rem;margin:.75rem 0 .35rem}",
  ".stats p{margin:.25rem 0}",
  "table{border-collapse:collapse;width:100%;margin-bottom:1rem}",
  "th,td{border:1px solid #e5e7eb;padding:.5rem .75rem;text-align:left}",
  "th{background:#f9fafb;font-weight:600}",
  "tr:nth-child(even) td{background:#fcfcfd}",
  ".empty{color:#6b7280;font-style:italic}",
].join("");

export function renderCanonicalReportStyledHtml(report: CanonicalReport): string {
  const rows: string[] = [];
  rows.push("<!DOCTYPE html><html><head><meta charset=\"utf-8\">");
  rows.push(`<style>${CANONICAL_HTML_STYLES}</style></head><body>`);
  rows.push(`<h1>${escapeHtml(report.title)}</h1>`);
  if (report.timezone) {
    rows.push(`<p class="meta">${escapeHtml(report.timezone)}</p>`);
  }
  for (const section of report.sections) {
    rows.push(renderSectionStyled(section, "h2"));
  }
  rows.push("</body></html>");
  return rows.join("");
}

export function renderCanonicalReportCsv(report: CanonicalReport): string {
  const lines: string[] = [];
  lines.push(csvEscape(report.title));
  if (report.timezone) lines.push(`Timezone,${csvEscape(report.timezone)}`);
  lines.push("");

  for (const section of report.sections) {
    if (section.stats?.length) {
      lines.push(csvEscape(section.label));
      lines.push("Metric,Value");
      for (const stat of section.stats) {
        lines.push(`${csvEscape(stat.label)},${csvEscape(stat.value)}`);
      }
      lines.push("");
    }
    for (const table of section.tables ?? []) {
      lines.push(csvEscape(table.label));
      lines.push(table.columns.map((c) => csvEscape(c)).join(","));
      for (const row of table.rows) {
        lines.push(row.map((c) => csvEscape(String(c ?? ""))).join(","));
      }
      lines.push("");
    }
    if (section.groups?.length) {
      lines.push(csvEscape(section.label));
      lines.push(["Group", "Item", "Details", "Due"].map((c) => csvEscape(c)).join(","));
      for (const group of section.groups) {
        for (const item of group.items) {
          lines.push(
            [
              csvEscape(group.label),
              csvEscape(item.title),
              csvEscape(item.subtitle ?? ""),
              csvEscape(item.dueLabel ?? item.dueDate ?? ""),
            ].join(","),
          );
        }
      }
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd();
}

export function renderCanonicalReportJson(report: CanonicalReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderCanonicalReportYaml(report: CanonicalReport): string {
  return stringifyYaml(report);
}

export function reportFilenameBase(report: CanonicalReport): string {
  return (
    report.title
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) || "report"
  );
}

export function renderReportDownloadArtifacts(report: CanonicalReport): {
  csv: string;
  json: string;
  yaml: string;
  filenameBase: string;
} {
  return {
    csv: renderCanonicalReportCsv(report),
    json: renderCanonicalReportJson(report),
    yaml: renderCanonicalReportYaml(report),
    filenameBase: reportFilenameBase(report),
  };
}

export function renderCanonicalReport(
  report: CanonicalReport,
  format: ReportRenderFormat,
): { plainText: string; html: string; csv: string; mimeType: string; extension: string } {
  const plainText = renderCanonicalReportPlain(report);
  const html = renderCanonicalReportStyledHtml(report);
  const csv = renderCanonicalReportCsv(report);
  if (format === "plain") {
    return { plainText, html, csv, mimeType: "text/plain;charset=utf-8", extension: "txt" };
  }
  return { plainText, html, csv, mimeType: "text/html;charset=utf-8", extension: "html" };
}

export function canonicalReportFilename(report: CanonicalReport, format: ReportRenderFormat): string {
  const slug = report.title
    .toLowerCase()
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  const rendered = renderCanonicalReport(report, format);
  return `${slug || "report"}.${rendered.extension}`;
}

export function renderCanonicalForExport(
  report: CanonicalReport,
  format: ReportRenderFormat,
): { plainText: string; html: string; mimeType: string; extension: string } {
  const rendered = renderCanonicalReport(report, format);
  return {
    plainText: rendered.plainText,
    html: rendered.html,
    mimeType: rendered.mimeType,
    extension: rendered.extension,
  };
}
