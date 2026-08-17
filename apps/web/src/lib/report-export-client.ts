export type ReportDownloadFormat = "csv" | "json" | "yaml";

export interface ReportPreviewDownloads {
  csv: string;
  json: string;
  yaml: string;
}

export function downloadReportFile(
  filenameBase: string,
  format: ReportDownloadFormat,
  content: string,
) {
  const mime =
    format === "csv"
      ? "text/csv;charset=utf-8"
      : format === "json"
        ? "application/json;charset=utf-8"
        : "text/yaml;charset=utf-8";
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filenameBase}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function printReportHtml(html: string, title: string) {
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.title = title;
  printWindow.document.close();
  printWindow.focus();
  const triggerPrint = () => printWindow.print();
  if (printWindow.document.readyState === "complete") {
    printWindow.setTimeout(triggerPrint, 50);
  } else {
    printWindow.addEventListener("load", triggerPrint, { once: true });
  }
}
