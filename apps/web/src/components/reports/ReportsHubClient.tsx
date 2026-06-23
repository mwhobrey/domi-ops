"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, apiClient } from "../../lib/client-api";
import type { ReportCatalogEntry, ReportKind, ReportModule } from "../../lib/reports";
import { WeeklyReportPanel } from "../WeeklyReportPanel";
import { ChoresCompletionReportSection } from "./ChoresCompletionReportSection";
import { ExpenseMonthlyReportSection } from "./ExpenseMonthlyReportSection";
import { HealthOverviewReportSection } from "./HealthOverviewReportSection";
import { SchoolReportsSection } from "./SchoolReportsSection";
import { ShoppingTripReportSection } from "./ShoppingTripReportSection";
import { Alert, Card, CardBody, Select, Spinner } from "../ui";

function parseModule(value: string | null): ReportModule | null {
  if (
    value === "school" ||
    value === "chores" ||
    value === "shopping" ||
    value === "expenses" ||
    value === "health"
  ) {
    return value;
  }
  return null;
}

function parseKind(value: string | null): ReportKind | null {
  if (
    value === "weekly" ||
    value === "overview" ||
    value === "school-grades" ||
    value === "school-open-work" ||
    value === "school-transcript"
  ) {
    return value;
  }
  return null;
}

function defaultKindForModule(module: ReportModule): ReportKind {
  if (module === "school") return "school-grades";
  if (module === "health") return "overview";
  return "overview";
}

export function ReportsHubClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [catalog, setCatalog] = useState<ReportCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [driveEnabled, setDriveEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const moduleParam = parseModule(searchParams.get("module"));
  const kindParam = parseKind(searchParams.get("kind"));
  const term = searchParams.get("term");
  const month = searchParams.get("month");

  const activeModule = moduleParam ?? catalog[0]?.module ?? "chores";
  const activeEntry = catalog.find((e) => e.module === activeModule);
  const activeKind =
    kindParam && activeEntry?.kinds.some((k) => k.id === kindParam)
      ? kindParam
      : (activeEntry?.kinds[0]?.id ?? defaultKindForModule(activeModule));

  const setSelection = useCallback(
    (module: ReportModule, kind: ReportKind) => {
      const params = new URLSearchParams({ module, kind });
      if (term && module === "school") params.set("term", term);
      if (month && module === "expenses") params.set("month", month);
      router.push(`/reports?${params}`);
    },
    [router, term, month],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setCatalogLoading(true);
      setError(null);
      try {
        const [catalogRes, sessionRes] = await Promise.all([
          apiClient.get<{ catalog: ReportCatalogEntry[] }>("/api/core/reports/catalog"),
          apiClient.get<{ modulesEnabled?: string[] }>("/auth/session").catch(() => ({
            modulesEnabled: [] as string[],
          })),
        ]);
        if (cancelled) return;
        setCatalog(catalogRes.catalog);
        setDriveEnabled((sessionRes.modulesEnabled ?? []).includes("drive"));
        if (!moduleParam && catalogRes.catalog[0]) {
          const first = catalogRes.catalog[0];
          const kind = first.kinds[0]?.id ?? defaultKindForModule(first.module);
          router.replace(`/reports?module=${first.module}&kind=${kind}`);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load reports catalog");
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [moduleParam, router]);

  const reportPane = useMemo(() => {
    if (activeModule === "school") {
      if (activeKind === "weekly") {
        return <WeeklyReportPanel module="school" driveEnabled={driveEnabled} />;
      }
      return (
        <SchoolReportsSection
          initialTerm={term}
          initialKind={activeKind}
          driveEnabled={driveEnabled}
        />
      );
    }
    if (activeModule === "chores") {
      if (activeKind === "weekly") {
        return <WeeklyReportPanel module="chores" driveEnabled={driveEnabled} />;
      }
      return <ChoresCompletionReportSection driveEnabled={driveEnabled} />;
    }
    if (activeModule === "shopping") {
      if (activeKind === "weekly") {
        return <WeeklyReportPanel module="shopping" driveEnabled={driveEnabled} />;
      }
      return <ShoppingTripReportSection driveEnabled={driveEnabled} />;
    }
    if (activeModule === "expenses") {
      if (activeKind === "weekly") {
        return <WeeklyReportPanel module="expenses" driveEnabled={driveEnabled} />;
      }
      return <ExpenseMonthlyReportSection driveEnabled={driveEnabled} initialMonth={month ?? undefined} />;
    }
    if (activeModule === "health") {
      return <HealthOverviewReportSection driveEnabled={driveEnabled} />;
    }
    return null;
  }, [activeModule, activeKind, driveEnabled, term, month]);

  if (catalogLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return <Alert variant="error">{error}</Alert>;
  }

  if (catalog.length === 0) {
    return (
      <Alert variant="info">
        No report modules are enabled for this household. Check settings to turn modules on.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="lg:hidden">
        <CardBody className="space-y-3">
          <nav aria-label="Report modules" className="flex gap-2 overflow-x-auto pb-1">
            {catalog.map((entry) => (
              <button
                key={entry.module}
                type="button"
                aria-current={entry.module === activeModule ? "page" : undefined}
                className={`shrink-0 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors ${
                  entry.module === activeModule
                    ? "bg-[var(--color-accent-subtle)] text-[var(--color-text)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-text)]"
                }`}
                onClick={() => {
                  const kind = entry.kinds[0]?.id ?? defaultKindForModule(entry.module);
                  setSelection(entry.module, kind);
                }}
              >
                {entry.moduleLabel}
              </button>
            ))}
          </nav>

          {activeEntry && activeEntry.kinds.length > 1 ? (
            activeEntry.kinds.length <= 4 ? (
              <nav aria-label="Report type" className="flex flex-wrap gap-2">
                {activeEntry.kinds.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    aria-current={k.id === activeKind ? "page" : undefined}
                    className={`rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors ${
                      k.id === activeKind
                        ? "bg-[var(--color-accent-subtle)] text-[var(--color-text)]"
                        : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-text)]"
                    }`}
                    onClick={() => setSelection(activeModule, k.id)}
                  >
                    {k.label}
                  </button>
                ))}
              </nav>
            ) : (
              <label className="block space-y-1 text-sm">
                <span className="text-[var(--color-text-muted)]">Report type</span>
                <Select
                  value={activeKind}
                  onChange={(e) => setSelection(activeModule, e.target.value as ReportKind)}
                  aria-label="Report type"
                >
                  {activeEntry.kinds.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </label>
            )
          ) : null}

          <p className="text-sm text-[var(--color-text-muted)]">
            Run and export without leaving this page.
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="hidden space-y-4 lg:block">
          <nav aria-label="Report modules" className="space-y-1">
            {catalog.map((entry) => (
              <button
                key={entry.module}
                type="button"
                aria-current={entry.module === activeModule ? "page" : undefined}
                className={`w-full rounded-[var(--radius-md)] px-3 py-2 text-left text-sm font-medium transition-colors ${
                  entry.module === activeModule
                    ? "bg-[var(--color-accent-subtle)] text-[var(--color-text)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-text)]"
                }`}
                onClick={() => {
                  const kind = entry.kinds[0]?.id ?? defaultKindForModule(entry.module);
                  setSelection(entry.module, kind);
                }}
              >
                {entry.moduleLabel}
              </button>
            ))}
          </nav>

          {activeEntry && activeEntry.kinds.length > 1 ? (
            <label className="block space-y-1 text-sm">
              <span className="text-[var(--color-text-muted)]">Report type</span>
              <Select
                value={activeKind}
                onChange={(e) => setSelection(activeModule, e.target.value as ReportKind)}
                aria-label="Report type"
              >
                {activeEntry.kinds.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
        </aside>

        <div className="min-w-0">{reportPane}</div>
      </div>
    </div>
  );
}
