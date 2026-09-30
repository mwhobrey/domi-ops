"use client";

import { FileText, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "../lib/client-api";
import {
  formatHours,
  schoolYearRange,
  type RecordStudent,
  type RecordsSettings,
  type StudentRecords,
} from "../lib/school-records";
import { useHouseholdToday } from "./HouseholdTimeProvider";
import { SchoolDaysCalendar } from "./SchoolDaysCalendar";
import { SchoolRecordsSettings } from "./SchoolRecordsSettings";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  LinkButton,
  SectionHeader,
  Select,
  StatTile,
} from "./ui";

/** Attendance days and instruction hours for one student over a date range, plus a transcript link. */
export function SchoolRecordsClient({ students }: { students: RecordStudent[] }) {
  const today = useHouseholdToday();
  const year = schoolYearRange(today);
  const [studentId, setStudentId] = useState(students[0]?.memberId ?? "");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const rangeFrom = from ?? year.from;
  const rangeTo = to ?? year.to;

  const [records, setRecords] = useState<StudentRecords | null>(null);
  const [settings, setSettings] = useState<RecordsSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await apiClient.get<RecordsSettings>("/api/school/settings/records"));
    } catch {
      setSettings(null);
    }
  }, []);

  // Switching students quickly leaves earlier requests in flight. If an old one lands last it
  // would show one student's records under another student's name, so only the newest applies.
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    if (!studentId) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<StudentRecords>(
        `/api/school/records/${studentId}?from=${rangeFrom}&to=${rangeTo}`,
      );
      if (sequence === loadSequence.current) setRecords(res);
    } catch {
      if (sequence === loadSequence.current) setError("Could not load records");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [studentId, rangeFrom, rangeTo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  if (students.length === 0) {
    return (
      <EmptyState
        title="No students yet"
        description="Enroll a student in a class and their attendance and hours will show up here."
        icon={<FileText className="h-10 w-10" aria-hidden />}
      />
    );
  }

  const transcriptHref = `/school/transcript/${studentId}?from=${rangeFrom}&to=${rangeTo}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        {students.length > 1 && (
          <div>
            <label htmlFor="records-student" className="text-label text-[var(--color-text-muted)]">
              Student
            </label>
            <Select
              id="records-student"
              className="mt-1"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
            >
              {students.map((s) => (
                <option key={s.memberId} value={s.memberId}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <label htmlFor="records-from" className="text-label text-[var(--color-text-muted)]">
            From
          </label>
          <Input id="records-from" type="date" className="mt-1" value={rangeFrom} onChange={(e) => setFrom(e.target.value || null)} />
        </div>
        <div>
          <label htmlFor="records-to" className="text-label text-[var(--color-text-muted)]">
            To
          </label>
          <Input id="records-to" type="date" className="mt-1" value={rangeTo} onChange={(e) => setTo(e.target.value || null)} />
        </div>
        <LinkButton href={transcriptHref} variant="secondary">
          <FileText className="h-4 w-4" aria-hidden />
          Transcript
        </LinkButton>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {records && (
        <div className={loading ? "opacity-60 transition" : "transition"}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              label={records.instruction.target ? `Days of instruction (of ${records.instruction.target})` : "Days of instruction"}
              value={records.instruction.count}
              tone={
                records.instruction.target && records.instruction.count >= records.instruction.target ? "success" : "default"
              }
            />
            <StatTile label="Hours logged" value={records.hours.totalHours} />
            {records.instruction.target ? (
              <StatTile
                label="Days to go"
                value={Math.max(0, records.instruction.target - records.instruction.count)}
              />
            ) : null}
          </div>
          {records.instruction.target ? (
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-border)]"
              role="progressbar"
              aria-label="Days of instruction toward target"
              aria-valuemin={0}
              aria-valuemax={records.instruction.target}
              aria-valuenow={Math.min(records.instruction.count, records.instruction.target)}
            >
              <div
                className="h-full bg-[var(--color-accent)] transition-[width]"
                style={{ width: `${Math.min(100, (records.instruction.count / records.instruction.target) * 100)}%` }}
              />
            </div>
          ) : null}

          <div className="mt-6 space-y-6">
            <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <SchoolDaysCalendar
              days={records.instruction.days}
              today={today}
              rangeFrom={rangeFrom}
              rangeTo={rangeTo}
              studentId={studentId}
              editableStudentIds={students.filter((s) => s.canEdit).map((s) => s.memberId)}
              canEdit={records.canEdit}
              onChanged={load}
            />
            <HoursLog records={records} studentId={studentId} onChanged={load} today={today} />
            </div>
            <AttendanceByClass records={records} />
            {settings?.canEdit && (
              <SchoolRecordsSettings
                initial={settings}
                onSaved={async () => {
                  await Promise.all([loadSettings(), load()]);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AttendanceByClass({ records }: { records: StudentRecords }) {
  return (
    <Card>
      <CardHeader>
        <SectionHeader title="Class attendance (optional)" />
      </CardHeader>
      <CardBody>
        {records.attendance.perClass.every((c) => c.recorded === 0) ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Nothing recorded. Most families just mark school days above. Class attendance is there for
            co-op or outside classes, and a class marked present also counts as a school day.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-label text-[var(--color-text-muted)]">
                <tr>
                  <th className="py-2 pr-4 font-medium">Class</th>
                  <th className="px-2 py-2 text-right font-medium">Present</th>
                  <th className="px-2 py-2 text-right font-medium">Late</th>
                  <th className="px-2 py-2 text-right font-medium">Absent</th>
                  <th className="px-2 py-2 text-right font-medium">Excused</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {records.attendance.perClass.map((c) => (
                  <tr key={c.classId}>
                    <td className="py-2 pr-4">{c.className}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.present}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.late}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.absent}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{c.excused}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function HoursLog({
  records,
  studentId,
  onChanged,
  today,
}: {
  records: StudentRecords;
  studentId: string;
  onChanged: () => Promise<void>;
  today: string;
}) {
  const [date, setDate] = useState<string | null>(null);
  const [hours, setHours] = useState("");
  const [classId, setClassId] = useState("");
  const [activity, setActivity] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const classNames = new Map(records.classes.map((c) => [c.id, c.name]));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const minutes = Math.round(Number(hours) * 60);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setError("Enter hours between 0.02 and 24");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiClient.post("/api/school/hours", {
        studentMemberId: studentId,
        logDate: date ?? today,
        minutes,
        classId: classId || null,
        activity: activity.trim(),
      });
      setHours("");
      setActivity("");
      await onChanged();
    } catch {
      setError("Could not save the entry");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiClient.delete(`/api/school/hours/${id}`);
      await onChanged();
    } catch {
      setError("Could not delete the entry");
    }
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader title="Hours log" />
      </CardHeader>
      <CardBody className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        {records.canEdit && (
          <form
            onSubmit={(e) => void add(e)}
            className="flex flex-wrap items-end gap-3"
            // Half-typed entries survive a tab switch (see WHO-348 auto-refresh).
            {...(hours || activity ? { "data-no-auto-refresh": "" } : {})}
          >
            <div>
              <label htmlFor="hours-date" className="text-label text-[var(--color-text-muted)]">
                Date
              </label>
              <Input id="hours-date" type="date" className="mt-1" value={date ?? today} onChange={(e) => setDate(e.target.value || null)} />
            </div>
            <div>
              <label htmlFor="hours-amount" className="text-label text-[var(--color-text-muted)]">
                Hours
              </label>
              <Input id="hours-amount" type="number" step="0.25" min="0.25" max="24" inputMode="decimal" className="mt-1 w-24" placeholder="1.5" value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
            <div className="min-w-40 flex-1">
              <label htmlFor="hours-class" className="text-label text-[var(--color-text-muted)]">
                Class
              </label>
              <Select id="hours-class" className="mt-1 w-full" value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">Not tied to a class</option>
                {records.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-40 flex-1">
              <label htmlFor="hours-activity" className="text-label text-[var(--color-text-muted)]">
                What
              </label>
              <Input id="hours-activity" className="mt-1" placeholder="Reading, field trip, co-op…" maxLength={128} value={activity} onChange={(e) => setActivity(e.target.value)} />
            </div>
            <Button type="submit" loading={saving} disabled={!hours}>
              Add
            </Button>
          </form>
        )}

        {records.hours.entries.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No hours logged in this range.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {records.hours.entries.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="tabular-nums text-[var(--color-text-muted)]">{h.logDate}</span>{" "}
                  <span className="font-medium">{h.activity || "Instruction"}</span>
                  {h.classId && classNames.get(h.classId) && classNames.get(h.classId) !== h.activity && (
                    <span className="text-[var(--color-text-muted)]"> · {classNames.get(h.classId)}</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums">{formatHours(h.minutes)} h</span>
                  {records.canEdit && (
                    <Button type="button" variant="ghost" size="sm" aria-label={`Delete ${h.logDate} entry`} onClick={() => void remove(h.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
