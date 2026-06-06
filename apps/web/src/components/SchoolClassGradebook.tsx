"use client";

import { AlertTriangle, BarChart3, BookOpen, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import {
  formatGradebookPercent,
  formatGradebookScore,
  gradebookCellLabel,
  gradebookCellTone,
  type GradebookData,
} from "../lib/school-gradebook";
import { Badge, EmptyState, LinkButton } from "./ui";

interface Member {
  id: string;
  shownLabel: string;
  email: string;
}

function memberLabel(member: Member | undefined, memberId: string): string {
  return member?.shownLabel ?? member?.email ?? memberId.slice(0, 8);
}

function assignmentRowAverage(
  assignmentId: string,
  students: GradebookData["students"],
): number | null {
  const percents = students
    .map((student) => student.cells.find((c) => c.assignmentId === assignmentId)?.percent)
    .filter((value): value is number => value != null);
  if (percents.length === 0) return null;
  return Math.round((percents.reduce((sum, value) => sum + value, 0) / percents.length) * 10) / 10;
}

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

export function SchoolClassGradebook({
  classId,
  gradebook,
  members,
  compact = false,
  showFullGradebookLink = true,
}: {
  classId: string;
  gradebook: GradebookData;
  members: Member[];
  compact?: boolean;
  showFullGradebookLink?: boolean;
}) {
  const { summary, assignments, students } = gradebook;
  const visibleAssignments = assignments.filter((a) => a.visibility !== "draft");

  if (visibleAssignments.length === 0) {
    return (
      <EmptyState
        title="No assignments to track"
        description="Publish assignments to see completion status and grades here."
        icon={<BookOpen className="h-10 w-10" aria-hidden />}
      />
    );
  }

  const showMatrix = !compact && students.length > 0;
  const showStudentSummary = students.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat label="Assignments" value={summary.assignmentCount} />
        <SummaryStat
          label="Missing work"
          value={summary.missingTotal}
          tone={summary.missingTotal > 0 ? "warning" : "default"}
        />
        <SummaryStat
          label="Overdue"
          value={summary.overdueTotal}
          tone={summary.overdueTotal > 0 ? "warning" : "success"}
        />
        <SummaryStat
          label="Class average"
          value={formatGradebookPercent(summary.classAveragePercent)}
          tone={
            summary.classAveragePercent != null && summary.classAveragePercent >= 70
              ? "success"
              : "default"
          }
        />
      </div>

      {students.length === 0 ? (
        <EmptyState
          title="No active students"
          description="Enroll students on the roster to track their progress."
          icon={<AlertTriangle className="h-10 w-10" aria-hidden />}
        />
      ) : showStudentSummary && !showMatrix ? (
        <ul className="space-y-2" aria-label="Student progress">
          {students.map((student) => {
            const label = memberLabel(
              members.find((m) => m.id === student.memberId),
              student.memberId,
            );
            return (
              <li
                key={student.enrollmentId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 bg-[var(--color-surface)]/40 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{label}</p>
                  <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {student.gradedCount} graded · {student.missingCount} missing
                    {student.overdueCount > 0 ? ` · ${student.overdueCount} overdue` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {student.averagePercent != null && (
                    <Badge tone="success">{formatGradebookPercent(student.averagePercent)}</Badge>
                  )}
                  {student.missingCount > 0 && (
                    <Badge tone="warning">{student.missingCount} missing</Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {showMatrix && (
        <div className="max-h-[min(70vh,48rem)] overflow-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
          <table className="w-full min-w-[640px] border-collapse text-sm" aria-label="Class gradebook">
            <caption className="sr-only">
              Assignments down the left, students across the top — completion and grades per cell
            </caption>
            <thead className="sticky top-0 z-20 bg-[var(--color-surface-subtle)]">
              <tr className="border-b border-[var(--color-border)]">
                <th
                  scope="col"
                  className="sticky left-0 z-30 min-w-[12rem] bg-[var(--color-surface-subtle)] px-3 py-2 text-left text-label text-[var(--color-text-muted)]"
                >
                  Assignment
                </th>
                {students.map((student) => {
                  const label = memberLabel(
                    members.find((m) => m.id === student.memberId),
                    student.memberId,
                  );
                  return (
                    <th
                      key={student.enrollmentId}
                      scope="col"
                      className="min-w-[7rem] px-2 py-2 text-left text-label text-[var(--color-text-muted)]"
                    >
                      <span className="line-clamp-2 font-medium text-[var(--color-text)]">{label}</span>
                      <span className="mt-0.5 block text-xs font-normal tabular-nums">
                        {formatGradebookPercent(student.averagePercent)}
                      </span>
                    </th>
                  );
                })}
                <th
                  scope="col"
                  className="min-w-[5rem] px-2 py-2 text-left text-label text-[var(--color-text-muted)]"
                >
                  Class avg
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleAssignments.map((assignment) => {
                const rowAverage = assignmentRowAverage(assignment.id, students);
                return (
                  <tr
                    key={assignment.id}
                    className="border-b border-[var(--color-border)]/60 last:border-0"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 min-w-[12rem] bg-[var(--color-surface-elevated)] px-3 py-2 text-left align-top font-medium"
                    >
                      <Link
                        href={`/school/assignment/${assignment.id}`}
                        className="line-clamp-3 text-[var(--color-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
                      >
                        {assignment.title}
                      </Link>
                      {assignment.dueAt && (
                        <span className="mt-1 block text-xs font-normal text-[var(--color-text-muted)]">
                          Due {new Date(assignment.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </th>
                    {students.map((student) => {
                      const cell = student.cells.find((c) => c.assignmentId === assignment.id);
                      const status = cell?.status ?? "missing";
                      const tone = gradebookCellTone(status);
                      return (
                        <td key={student.enrollmentId} className="px-2 py-2 align-top">
                          <div className="flex flex-col gap-0.5">
                            <Badge tone={tone}>{gradebookCellLabel(status)}</Badge>
                            {cell?.score != null && (
                              <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
                                {formatGradebookScore(cell.score, assignment.pointsPossible)}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 align-top tabular-nums text-[var(--color-text-muted)]">
                      {formatGradebookPercent(rowAverage)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {compact && showFullGradebookLink && students.length > 0 && (
        <div className="flex justify-end">
          <LinkButton href={`/school/class/${classId}/gradebook`} variant="ghost" size="sm">
            <BarChart3 className="h-4 w-4" aria-hidden />
            Full gradebook
          </LinkButton>
        </div>
      )}
    </div>
  );
}

export function SchoolClassGradebookSection({
  classId,
  gradebook,
  members,
  showFullGradebookLink = true,
}: {
  classId: string;
  gradebook: GradebookData;
  members: Member[];
  showFullGradebookLink?: boolean;
}) {
  return (
    <section aria-labelledby="gradebook-heading">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 id="gradebook-heading" className="text-label text-[var(--color-text-muted)]">
          Progress
        </h2>
        {gradebook.summary.gradedTotal > 0 ? (
          <Badge tone="success">
            <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden />
            {gradebook.summary.gradedTotal} graded
          </Badge>
        ) : null}
      </div>
      <SchoolClassGradebook
        classId={classId}
        gradebook={gradebook}
        members={members}
        compact
        showFullGradebookLink={showFullGradebookLink}
      />
    </section>
  );
}
