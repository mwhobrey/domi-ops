"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import {
  ATTENDANCE_OPTIONS,
  type AttendanceRow,
  type AttendanceStatus,
} from "../lib/school-records";
import { Alert, Button, Card, CardBody, CardHeader, Input, SectionHeader } from "./ui";
import { useHouseholdToday } from "./HouseholdTimeProvider";

type Marks = Record<string, AttendanceStatus | null>;

/** Take attendance for one class on one day. Students see their own mark, read-only. */
export function SchoolAttendanceCard({
  classId,
  students,
}: {
  classId: string;
  students: { id: string; label: string }[];
}) {
  const today = useHouseholdToday();
  const [date, setDate] = useState<string | null>(null);
  const day = date ?? today;

  const [saved, setSaved] = useState<Marks>({});
  const [marks, setMarks] = useState<Marks>({});
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ attendance: AttendanceRow[]; canEdit: boolean }>(
        `/api/school/classes/${classId}/attendance?from=${day}&to=${day}`,
      );
      const next: Marks = {};
      for (const row of res.attendance) next[row.studentMemberId] = row.status;
      setSaved(next);
      setMarks(next);
      setCanEdit(res.canEdit);
    } catch (e) {
      setError(e instanceof ApiError ? "Could not load attendance" : "Could not load attendance");
    } finally {
      setLoading(false);
    }
  }, [classId, day]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = useMemo(
    () => students.filter((s) => (marks[s.id] ?? null) !== (saved[s.id] ?? null)),
    [students, marks, saved],
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiClient.put(`/api/school/classes/${classId}/attendance`, {
        date: day,
        entries: changed.map((s) => ({ studentMemberId: s.id, status: marks[s.id] ?? null })),
      });
      setSaved(marks);
      setSavedNote(`Saved ${changed.length} ${changed.length === 1 ? "change" : "changes"}`);
    } catch {
      setError("Could not save attendance. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const visible = canEdit ? students : students.filter((s) => s.id in marks);

  return (
    // Marker so the auto-refresh on tab return (WHO-348) never wipes marks that aren't saved yet.
    <Card {...(changed.length > 0 ? { "data-no-auto-refresh": "" } : {})}>
      <CardHeader>
        <SectionHeader
          title="Class attendance (optional)"
          action={
            <Input
              type="date"
              aria-label="Attendance date"
              value={day}
              onChange={(e) => {
                setDate(e.target.value || null);
                setSavedNote(null);
              }}
              className="w-auto"
            />
          }
        />
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-[var(--color-text-muted)]">
          Optional, for co-op or outside classes. Most families just mark school days on the{" "}
          <a href="/school/records" className="text-[var(--color-accent)] hover:underline">
            Records
          </a>{" "}
          page. A class marked present or late also counts as a school day.
        </p>
        {error && <Alert variant="error">{error}</Alert>}
        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            {canEdit ? "Enroll a student to take attendance." : "No attendance recorded for this day."}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {visible.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm font-medium">{s.label}</span>
                {canEdit ? (
                  <div role="radiogroup" aria-label={`${s.label} attendance`} className="flex flex-wrap gap-1">
                    {ATTENDANCE_OPTIONS.map((opt) => {
                      const on = marks[s.id] === opt.value;
                      return (
                        <Button
                          key={opt.value}
                          type="button"
                          size="sm"
                          variant={on ? "primary" : "secondary"}
                          role="radio"
                          aria-checked={on}
                          // Tap the active one again to clear a mistaken mark.
                          onClick={() => setMarks((m) => ({ ...m, [s.id]: on ? null : opt.value }))}
                        >
                          {opt.label}
                        </Button>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-sm capitalize">{marks[s.id]}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && students.length > 0 && !loading && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.id, "present"])))}
            >
              Mark all present
            </Button>
            <Button type="button" onClick={() => void save()} loading={saving} disabled={changed.length === 0}>
              Save attendance
            </Button>
            {savedNote && changed.length === 0 && (
              <span className="text-xs text-[var(--color-text-muted)]" role="status">
                {savedNote}
              </span>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
