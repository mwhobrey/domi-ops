"use client";

import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  LineChart,
  Scale,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatGradebookPercent } from "../lib/school-gradebook";
import {
  downloadAllTranscriptsCsv,
  downloadMissingDigestCsv,
  downloadReportsSummaryCsv,
  downloadTranscriptCsv,
} from "../lib/school-report-export";
import {
  reportsUrl,
  type SchoolReportsData,
  type SchoolReportView,
} from "../lib/school-reports";
import { Badge, Button, EmptyState, LinkButton, Select } from "./ui";

function SummaryStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "text-[var(--color-warning)]"
      : tone === "success"
        ? "text-[var(--color-success)]"
        : "text-[var(--color-text)]";
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-4">
      <p className="text-label text-[var(--color-text-muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function TermFilter({
  availableTerms,
  selectedTerm,
}: {
  availableTerms: string[];
  selectedTerm: string | null;
}) {
  const router = useRouter();
  if (availableTerms.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-[var(--color-text-muted)]">Term</span>
      <Select
        className="min-w-[10rem]"
        value={selectedTerm ?? ""}
        aria-label="Filter by term"
        onChange={(e) => {
          const value = e.target.value;
          router.push(reportsUrl(value || null));
        }}
      >
        <option value="">All terms</option>
        {availableTerms.map((term) => (
          <option key={term} value={term}>
            {term}
          </option>
        ))}
      </Select>
    </div>
  );
}

function ViewTabs({
  view,
  onChange,
  reports,
}: {
  view: SchoolReportView;
  onChange: (view: SchoolReportView) => void;
  reports: SchoolReportsData;
}) {
  const tabs: { id: SchoolReportView; label: string }[] = [
    { id: "by-class", label: "By class" },
    ...(reports.students.length > 0 ? [{ id: "by-student" as const, label: "By student" }] : []),
    { id: "weighted", label: "Weighted" },
    { id: "missing", label: "Open work" },
    { id: "progress", label: "Progress" },
    { id: "transcript", label: "Transcript" },
  ];

  return (
    <div
      className="flex flex-wrap gap-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-1 text-sm"
      role="tablist"
      aria-label="Report view"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={view === tab.id}
          className={`rounded-[var(--radius-md)] px-3 py-1.5 font-medium transition-colors ${
            view === tab.id
              ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ClassReportsTable({ reports }: { reports: SchoolReportsData }) {
  const isStudent = reports.viewMode === "student";
  if (reports.classes.length === 0) {
    return (
      <EmptyState
        title="No classes to report on"
        description="Create a class and publish assignments to see grade summaries here."
        icon={<BookOpen className="h-10 w-10" aria-hidden />}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <table className="w-full min-w-[720px] border-collapse text-sm" aria-label="Grades by class">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
            <th scope="col" className="px-3 py-2 text-left text-label text-[var(--color-text-muted)]">Class</th>
            {!isStudent && <th scope="col" className="px-3 py-2 text-left text-label text-[var(--color-text-muted)]">Students</th>}
            <th scope="col" className="px-3 py-2 text-left text-label text-[var(--color-text-muted)]">Assignments</th>
            <th scope="col" className="px-3 py-2 text-left text-label text-[var(--color-text-muted)]">{isStudent ? "Your avg" : "Average"}</th>
            <th scope="col" className="px-3 py-2 text-left text-label text-[var(--color-text-muted)]">Weighted</th>
            <th scope="col" className="px-3 py-2 text-left text-label text-[var(--color-text-muted)]">Missing</th>
            <th scope="col" className="px-3 py-2 text-left text-label text-[var(--color-text-muted)]">Overdue</th>
          </tr>
        </thead>
        <tbody>
          {reports.classes.map((row) => (
            <tr key={row.classId} className="border-b border-[var(--color-border)]/60 last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-medium">
                <Link href={`/school/class/${row.classId}`} className="text-[var(--color-accent)] hover:underline">{row.className}</Link>
                {(row.term || row.subject) && (
                  <span className="mt-0.5 block text-xs font-normal text-[var(--color-text-muted)]">
                    {[row.term, row.subject].filter(Boolean).join(" · ")}
                  </span>
                )}
              </th>
              {!isStudent && <td className="px-3 py-2 tabular-nums">{row.studentCount}</td>}
              <td className="px-3 py-2 tabular-nums">{row.assignmentCount}</td>
              <td className="px-3 py-2 tabular-nums">{formatGradebookPercent(row.classAveragePercent)}</td>
              <td className="px-3 py-2 tabular-nums">{formatGradebookPercent(row.weightedClassAveragePercent)}</td>
              <td className="px-3 py-2">{row.missingTotal > 0 ? <Badge tone="warning">{row.missingTotal}</Badge> : "0"}</td>
              <td className="px-3 py-2">{row.overdueTotal > 0 ? <Badge tone="warning">{row.overdueTotal}</Badge> : "0"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StudentReportRowItem({ student }: { student: SchoolReportsData["students"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 bg-[var(--color-surface)]/40">
      <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <div className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
          <div>
            <p className="font-medium">{student.label}</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {student.classes.length} classes · weighted {formatGradebookPercent(student.weightedAveragePercent)}
            </p>
          </div>
        </div>
        <Badge tone={student.averagePercent != null && student.averagePercent >= 70 ? "success" : "default"}>
          {formatGradebookPercent(student.averagePercent)}
        </Badge>
      </button>
      {open && (
        <ul className="border-t border-[var(--color-border)]/60 px-4 py-2">
          {student.classes.map((cls) => (
            <li key={cls.classId} className="flex items-center justify-between gap-3 border-b border-[var(--color-border)]/40 py-2 last:border-0">
              <Link href={`/school/class/${cls.classId}`} className="text-sm text-[var(--color-accent)] hover:underline">{cls.className}</Link>
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                {cls.missingCount > 0 && <Badge tone="warning">{cls.missingCount} missing</Badge>}
                <span>{formatGradebookPercent(cls.weightedAveragePercent ?? cls.averagePercent)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WeightedReportsView({ reports }: { reports: SchoolReportsData }) {
  if (reports.students.length === 0) {
    return <EmptyState title="No weighted grades yet" description="Add categories with weights on a class, then grade assignments." icon={<Scale className="h-10 w-10" aria-hidden />} />;
  }

  return (
    <div className="space-y-4">
      {reports.students.map((student) => (
        <div key={student.memberId} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{student.label}</h3>
            <Badge tone="success">Weighted {formatGradebookPercent(student.weightedAveragePercent)}</Badge>
          </div>
          <div className="space-y-3">
            {student.classes.map((cls) => (
              <div key={cls.classId}>
                <p className="text-sm font-medium text-[var(--color-text-muted)]">{cls.className}</p>
                {cls.categoryBreakdown.length === 0 ? (
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">No categories — using points average {formatGradebookPercent(cls.averagePercent)}</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {cls.categoryBreakdown.map((cat) => (
                      <li key={cat.categoryId ?? "uncategorized"} className="flex justify-between gap-3 text-sm">
                        <span>{cat.categoryName}{cat.weightPercent > 0 ? ` (${cat.weightPercent}%)` : ""}</span>
                        <span className="tabular-nums">{formatGradebookPercent(cat.averagePercent)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MissingDigestView({ reports }: { reports: SchoolReportsData }) {
  if (reports.missingDigest.length === 0) {
    return <EmptyState title="Nothing open" description="All assigned work is graded or on track." icon={<ClipboardList className="h-10 w-10" aria-hidden />} />;
  }

  const statusLabel = { missing: "Missing", overdue: "Overdue", submitted: "Submitted" } as const;
  const statusTone = { missing: "warning", overdue: "warning", submitted: "accent" } as const;

  return (
    <ul className="space-y-2" aria-label="Open work digest">
      {reports.missingDigest.map((item) => (
        <li key={`${item.assignmentId}:${item.studentMemberId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 px-4 py-3">
          <div className="min-w-0">
            <Link href={`/school/assignment/${item.assignmentId}`} className="font-medium text-[var(--color-accent)] hover:underline">{item.assignmentTitle}</Link>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {item.studentLabel} · {item.className}
              {item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString()}` : ""}
            </p>
          </div>
          <Badge tone={statusTone[item.status]}>{statusLabel[item.status]}</Badge>
        </li>
      ))}
    </ul>
  );
}

function ProgressChart({ points }: { points: SchoolReportsData["progress"][number]["points"] }) {
  if (points.length === 0) return null;
  const width = 480;
  const height = 120;
  const padding = 12;
  const minY = Math.max(0, Math.min(...points.map((p) => p.cumulativeAveragePercent)) - 10);
  const maxY = Math.min(100, Math.max(...points.map((p) => p.cumulativeAveragePercent)) + 10);
  const rangeY = maxY - minY || 1;

  const coords = points.map((point, index) => {
    const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((point.cumulativeAveragePercent - minY) / rangeY) * (height - padding * 2);
    return { x, y, point };
  });

  const polyline = coords.map((c) => `${c.x},${c.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full max-w-xl text-[var(--color-accent)]" role="img" aria-label="Cumulative grade progress">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={polyline} />
      {coords.map((c) => (
        <circle key={c.point.gradedCount} cx={c.x} cy={c.y} r="3" fill="currentColor" />
      ))}
    </svg>
  );
}

function ProgressView({ reports }: { reports: SchoolReportsData }) {
  const [seriesKey, setSeriesKey] = useState(reports.progress[0] ? `${reports.progress[0].memberId}:${reports.progress[0].classId}` : "");
  const active = reports.progress.find((s) => `${s.memberId}:${s.classId}` === seriesKey) ?? reports.progress[0];

  if (reports.progress.length === 0) {
    return <EmptyState title="No graded progress yet" description="Grade assignments to see cumulative averages over time." icon={<LineChart className="h-10 w-10" aria-hidden />} />;
  }

  return (
    <div className="space-y-4">
      {reports.progress.length > 1 && (
        <Select className="max-w-md" value={seriesKey} aria-label="Progress series" onChange={(e) => setSeriesKey(e.target.value)}>
          {reports.progress.map((series) => (
            <option key={`${series.memberId}:${series.classId}`} value={`${series.memberId}:${series.classId}`}>
              {series.label} — {series.className}
            </option>
          ))}
        </Select>
      )}
      {active && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <p className="font-medium">{active.label} · {active.className}</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Cumulative average after each graded assignment</p>
          <div className="mt-4"><ProgressChart points={active.points} /></div>
          <ol className="mt-4 space-y-1 text-sm">
            {active.points.map((point) => (
              <li key={point.gradedCount} className="flex justify-between gap-3">
                <span className="truncate">{point.label}</span>
                <span className="shrink-0 tabular-nums">{formatGradebookPercent(point.cumulativeAveragePercent)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function TranscriptView({ reports }: { reports: SchoolReportsData }) {
  const [memberId, setMemberId] = useState(reports.transcripts[0]?.memberId ?? "");
  const transcript = reports.transcripts.find((t) => t.memberId === memberId) ?? reports.transcripts[0];

  if (!transcript) {
    return <EmptyState title="No transcript data" description="Grade assignments to build a transcript export." icon={<Download className="h-10 w-10" aria-hidden />} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {reports.transcripts.length > 1 && (
          <Select className="max-w-xs" value={memberId} aria-label="Student transcript" onChange={(e) => setMemberId(e.target.value)}>
            {reports.transcripts.map((row) => (
              <option key={row.memberId} value={row.memberId}>{row.label}</option>
            ))}
          </Select>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => downloadTranscriptCsv(transcript)}>
          <Download className="h-4 w-4" aria-hidden />
          Download CSV
        </Button>
        {reports.transcripts.length > 1 && reports.viewMode !== "student" && (
          <Button type="button" variant="ghost" size="sm" onClick={() => downloadAllTranscriptsCsv(reports)}>
            Download all
          </Button>
        )}
      </div>
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
        <p className="text-lg font-semibold">{transcript.label}</p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Overall {formatGradebookPercent(transcript.averagePercent)} · Weighted {formatGradebookPercent(transcript.weightedAveragePercent)}
        </p>
        {transcript.classes.map((cls) => (
          <div key={cls.classId} className="mt-4 border-t border-[var(--color-border)]/60 pt-4 first:mt-3 first:border-0 first:pt-0">
            <p className="font-medium">{cls.className}{cls.term ? ` (${cls.term})` : ""}</p>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-label text-[var(--color-text-muted)]">
                  <th className="py-1 pr-2">Assignment</th>
                  <th className="py-1 pr-2">Category</th>
                  <th className="py-1 pr-2">Score</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {cls.assignments.map((row) => (
                  <tr key={row.assignmentId} className="border-t border-[var(--color-border)]/40">
                    <td className="py-1.5 pr-2">{row.title}</td>
                    <td className="py-1.5 pr-2 text-[var(--color-text-muted)]">{row.categoryName ?? "—"}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{row.score != null ? `${row.score}/${row.pointsPossible}` : "—"}</td>
                    <td className="py-1.5 capitalize text-[var(--color-text-muted)]">{row.status.replace("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SchoolReports({ reports }: { reports: SchoolReportsData }) {
  const isStudent = reports.viewMode === "student";
  const [view, setView] = useState<SchoolReportView>("by-class");

  const exportActions = useMemo(() => {
    if (view === "missing") return { label: "Export open work CSV", action: () => downloadMissingDigestCsv(reports) };
    if (view === "transcript") return null;
    return { label: "Export summary CSV", action: () => downloadReportsSummaryCsv(reports) };
  }, [view, reports]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat label="Classes" value={reports.summary.classCount} />
        {!isStudent && <SummaryStat label="Students" value={reports.summary.studentCount} />}
        <SummaryStat label="Weighted avg" value={formatGradebookPercent(reports.summary.householdWeightedAveragePercent)} tone={reports.summary.householdWeightedAveragePercent != null && reports.summary.householdWeightedAveragePercent >= 70 ? "success" : "default"} />
        <SummaryStat label="Open items" value={reports.summary.missingTotal + reports.summary.overdueTotal} tone={reports.summary.missingTotal + reports.summary.overdueTotal > 0 ? "warning" : "default"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TermFilter availableTerms={reports.availableTerms} selectedTerm={reports.selectedTerm} />
        {exportActions && (
          <Button type="button" variant="ghost" size="sm" onClick={exportActions.action}>
            <Download className="h-4 w-4" aria-hidden />
            {exportActions.label}
          </Button>
        )}
      </div>

      <ViewTabs view={view} onChange={setView} reports={reports} />

      {view === "by-class" && <ClassReportsTable reports={reports} />}
      {view === "by-student" && (
        reports.students.length === 0 ? (
          <EmptyState title="No student grades yet" description="Enroll students and grade assignments." icon={<Users className="h-10 w-10" aria-hidden />} />
        ) : (
          <div className="space-y-2">{reports.students.map((s) => <StudentReportRowItem key={s.memberId} student={s} />)}</div>
        )
      )}
      {view === "weighted" && <WeightedReportsView reports={reports} />}
      {view === "missing" && <MissingDigestView reports={reports} />}
      {view === "progress" && <ProgressView reports={reports} />}
      {view === "transcript" && <TranscriptView reports={reports} />}

      {reports.summary.missingTotal > 0 && view !== "missing" && (
        <p className="flex items-center gap-2 text-sm text-[var(--color-warning)]">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {reports.summary.missingTotal} missing · {reports.summary.overdueTotal} overdue — check Open work
        </p>
      )}
    </div>
  );
}

export function SchoolReportsLink() {
  return (
    <LinkButton href="/school/reports" variant="secondary" size="sm">
      <BarChart3 className="h-4 w-4" aria-hidden />
      Grade reports
    </LinkButton>
  );
}
