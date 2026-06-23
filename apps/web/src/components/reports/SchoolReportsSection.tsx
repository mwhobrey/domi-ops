"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ApiError, apiClient } from "../../lib/client-api";
import type { SchoolReportsData } from "../../lib/school-reports";
import { SchoolReports } from "../SchoolReports";
import { Alert, Spinner } from "../ui";

import type { ReportKind } from "../../lib/reports";
import type { SchoolReportView } from "../../lib/school-reports";

function schoolKindToView(kind: ReportKind): SchoolReportView {
  switch (kind) {
    case "school-open-work":
      return "missing";
    case "school-transcript":
      return "transcript";
    case "weekly":
      return "weekly";
    default:
      return "by-class";
  }
}

export function SchoolReportsSection({
  initialTerm,
  initialKind = "school-grades",
  driveEnabled = true,
}: {
  initialTerm?: string | null;
  initialKind?: ReportKind;
  driveEnabled?: boolean;
}) {
  const searchParams = useSearchParams();
  const term = initialTerm ?? searchParams.get("term");
  const [reports, setReports] = useState<SchoolReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = term ? `?term=${encodeURIComponent(term)}` : "";
      const data = await apiClient.get<SchoolReportsData>(`/api/school/reports${query}`);
      setReports(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load grade reports");
      setReports(null);
    } finally {
      setLoading(false);
    }
  }, [term]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !reports) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="error">
        {error}{" "}
        <button type="button" className="underline" onClick={() => void load()}>
          Retry
        </button>
      </Alert>
    );
  }

  if (!reports) return null;

  return (
    <SchoolReports
      reports={reports}
      driveEnabled={driveEnabled}
      initialView={schoolKindToView(initialKind)}
    />
  );
}
