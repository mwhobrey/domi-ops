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
