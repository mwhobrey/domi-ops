"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { apiClient } from "../lib/client-api";
import { monthGrid, shiftMonth, weekdaysOfWeek, type DayActivity } from "../lib/school-records";
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, SectionHeader } from "./ui";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The homeschool "attendance": tap the days school happened. A day also counts by itself when
 * hours were logged or a class marked the student present, shown with a dot instead of a fill.
 */
export function SchoolDaysCalendar({
  days,
  today,
  rangeFrom,
  rangeTo,
  studentId,
  editableStudentIds,
  canEdit,
  onChanged,
}: {
  days: DayActivity[];
  today: string;
  rangeFrom: string;
  rangeTo: string;
  studentId: string;
  /** Every student the viewer may mark days for (siblings usually share school days). */
  editableStudentIds: string[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [allStudents, setAllStudents] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const multi = editableStudentIds.length > 1;
  const targets = multi && allStudents ? editableStudentIds : [studentId];

  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const canPrev = shiftMonth(month, -1) >= rangeFrom.slice(0, 7);
  const canNext = shiftMonth(month, 1) <= rangeTo.slice(0, 7);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await apiClient.put("/api/school/records/days", { studentMemberIds: targets, ...body });
      await onChanged();
    } catch {
      setError("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (date: string) => {
    if (!canEdit || busy) return;
    void send({ dates: [date], marked: !byDate.get(date)?.marked });
  };

  const week = weekdaysOfWeek(today);

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="School days"
          action={
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" aria-label="Previous month" disabled={!canPrev} onClick={() => setMonth(shiftMonth(month, -1))}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <span className="min-w-32 text-center text-sm font-medium" aria-live="polite">
                {monthLabel}
              </span>
              <Button type="button" variant="ghost" size="sm" aria-label="Next month" disabled={!canNext} onClick={() => setMonth(shiftMonth(month, 1))}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          }
        />
      </CardHeader>
      <CardBody className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        <p className="text-sm text-[var(--color-text-muted)]">
          {canEdit
            ? "Tap the days school happened. No roll call, no absences: days you skip simply aren't school days."
            : "Days of instruction recorded for this student."}
        </p>

        <div role="grid" aria-label={`School days, ${monthLabel}`} className={cn("mx-auto max-w-md select-none", busy && "opacity-60")}>
          <div role="row" className="grid grid-cols-7 gap-1 text-center text-xs text-[var(--color-text-muted)]">
            {WEEKDAYS.map((d) => (
              <div key={d} role="columnheader" className="py-1">
                {d}
              </div>
            ))}
          </div>
          {weeks.map((row, i) => (
            <div key={i} role="row" className="mt-1 grid grid-cols-7 gap-1">
              {row.map((date, j) => {
                if (!date) return <div key={j} role="gridcell" />;
                const a = byDate.get(date);
                const marked = a?.marked ?? false;
                const derived = !marked && a != null;
                const outside = date < rangeFrom || date > rangeTo;
                const label = a
                  ? [marked && "marked", a.minutes > 0 && `${a.minutes} minutes logged`, a.classAttendance && "class attendance"]
                      .filter(Boolean)
                      .join(", ")
                  : "not a school day";
                return (
                  <button
                    key={date}
                    role="gridcell"
                    type="button"
                    disabled={!canEdit || outside}
                    aria-pressed={marked}
                    aria-label={`${date}: ${label}`}
                    title={derived ? "Counted from logged hours or class attendance. Tap to mark it too." : undefined}
                    onClick={() => toggle(date)}
                    className={cn(
                      "relative aspect-square rounded-[var(--radius-lg)] border text-sm tabular-nums transition",
                      marked
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)] font-semibold text-white"
                        : derived
                          ? "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10"
                          : "border-[var(--color-border)] hover:bg-[var(--color-border)]/40",
                      date === today && !marked && "ring-1 ring-[var(--color-accent)]",
                      (!canEdit || outside) && "cursor-default opacity-50 hover:bg-transparent",
                    )}
                  >
                    {Number(date.slice(8))}
                    {derived && (
                      <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--color-accent)]" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void send({ dates: [today], marked: true })}>
              Today was a school day
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void send({ range: week, marked: true })}>
              Mark this week (Mon–Fri)
            </Button>
            {multi && (
              <Checkbox
                checked={allStudents}
                onChange={(e) => setAllStudents(e.target.checked)}
                label="Apply to all students"
              />
            )}
          </div>
        )}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-[var(--color-accent)]" aria-hidden /> Marked
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10" aria-hidden /> Counted from hours or class attendance
          </span>
        </p>
      </CardBody>
    </Card>
  );
}
