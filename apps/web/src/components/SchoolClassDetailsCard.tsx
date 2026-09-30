"use client";

import { Clock, Pencil } from "lucide-react";
import { useState } from "react";
import { ApiError, apiClient } from "../lib/client-api";
import { formatClassSchedule, scheduleToJson } from "../lib/school-schedule";
import type { ClassMeta, Member } from "../lib/school-class-types";
import { Alert, Avatar, Badge, Button, Card, CardBody, CardHeader, Checkbox, Input, SectionHeader, Select } from "./ui";

/** The "Class details" card on a class detail page — view/edit form for name, term, teacher,
 *  schedule, and archived state. Owns its own edit-mode state so it's independent of the
 *  assignments and roster cards next to it. */
export function SchoolClassDetailsCard({
  classId,
  initialClass,
  members,
  canEditClassMeta,
}: {
  classId: string;
  initialClass: ClassMeta;
  members: Member[];
  canEditClassMeta: boolean;
}) {
  const [classMeta, setClassMeta] = useState(initialClass);
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaTerm, setMetaTerm] = useState(classMeta.term ?? "");
  const [metaTeacherId, setMetaTeacherId] = useState(classMeta.teacherMemberId);
  const [metaSchedule, setMetaSchedule] = useState(formatClassSchedule(classMeta.scheduleJson) ?? "");
  const [metaArchived, setMetaArchived] = useState(classMeta.archived ?? false);
  const [metaCredits, setMetaCredits] = useState(String(classMeta.credits ?? 1));
  const [metaSaving, setMetaSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teacher = members.find((m) => m.id === classMeta.teacherMemberId);
  const scheduleLabel = formatClassSchedule(classMeta.scheduleJson);

  async function saveMeta() {
    const credits = Number(metaCredits);
    if (!Number.isFinite(credits) || credits < 0 || credits > 10) {
      setError("Credits must be between 0 and 10");
      return;
    }
    setMetaSaving(true);
    setError(null);
    try {
      const data = await apiClient.patch<{ class: ClassMeta }>(`/api/school/classes/${classId}`, {
        term: metaTerm.trim() || null,
        teacherMemberId: metaTeacherId,
        scheduleJson: scheduleToJson(metaSchedule),
        archived: metaArchived,
        credits,
      });
      setClassMeta((prev) => ({ ...prev, ...data.class }));
      setEditingMeta(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update class");
    } finally {
      setMetaSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Class details"
          action={
            canEditClassMeta && !editingMeta ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMetaTerm(classMeta.term ?? "");
                  setMetaTeacherId(classMeta.teacherMemberId);
                  setMetaSchedule(formatClassSchedule(classMeta.scheduleJson) ?? "");
                  setMetaArchived(classMeta.archived ?? false);
                  setMetaCredits(String(classMeta.credits ?? 1));
                  setEditingMeta(true);
                }}
                aria-label="Edit class details"
              >
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Button>
            ) : null
          }
        />
      </CardHeader>
      <CardBody>
        {error && <Alert variant="error">{error}</Alert>}
        {editingMeta ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveMeta();
            }}
          >
            <div>
              <label htmlFor="class-term" className="text-label text-[var(--color-text-muted)]">
                Term
              </label>
              <Input
                id="class-term"
                className="mt-1"
                placeholder="Fall 2026"
                value={metaTerm}
                onChange={(e) => setMetaTerm(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="class-teacher" className="text-label text-[var(--color-text-muted)]">
                Teacher
              </label>
              <Select
                id="class-teacher"
                className="mt-1 w-full"
                value={metaTeacherId}
                onChange={(e) => setMetaTeacherId(e.target.value)}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.shownLabel || m.email}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="class-credits" className="text-label text-[var(--color-text-muted)]">
                Credits
              </label>
              <Input
                id="class-credits"
                type="number"
                step="0.25"
                min="0"
                max="10"
                className="mt-1"
                value={metaCredits}
                onChange={(e) => setMetaCredits(e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">1 = a full-year course. Used on transcripts.</p>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="class-schedule" className="text-label text-[var(--color-text-muted)]">
                Schedule
              </label>
              <Input
                id="class-schedule"
                className="mt-1"
                placeholder="Mon/Wed 9:00 AM · Kitchen table"
                value={metaSchedule}
                onChange={(e) => setMetaSchedule(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Checkbox
                id="class-archived"
                checked={metaArchived}
                onChange={(e) => setMetaArchived(e.target.checked)}
                label="Archive class (hide from active lists)"
              />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" loading={metaSaving}>
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditingMeta(false)}
                disabled={metaSaving}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-3">
            {classMeta.archived && (
              <div className="sm:col-span-3">
                <Badge tone="warning">Archived</Badge>
              </div>
            )}
            <div>
              <dt className="text-label text-[var(--color-text-muted)]">Subject</dt>
              <dd className="mt-1 text-sm font-medium">
                {classMeta.subject ?? <span className="text-[var(--color-text-muted)]">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-label text-[var(--color-text-muted)]">Term</dt>
              <dd className="mt-1 text-sm font-medium">
                {classMeta.term ? (
                  <Badge tone="accent">{classMeta.term}</Badge>
                ) : (
                  <span className="text-[var(--color-text-muted)]">Not set</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-label text-[var(--color-text-muted)]">Teacher</dt>
              <dd className="mt-1 flex items-center gap-2 text-sm font-medium">
                {teacher ? (
                  <>
                    <Avatar id={teacher.id} name={teacher.shownLabel || teacher.email} size="sm" />
                    <span>{teacher.shownLabel || teacher.email}</span>
                  </>
                ) : (
                  <span className="text-[var(--color-text-muted)]">Unknown</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-label text-[var(--color-text-muted)]">Credits</dt>
              <dd className="mt-1 text-sm font-medium">{classMeta.credits ?? 1}</dd>
            </div>
            {scheduleLabel && (
              <div className="sm:col-span-3">
                <dt className="flex items-center gap-1.5 text-label text-[var(--color-text-muted)]">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  Schedule
                </dt>
                <dd className="mt-1 text-sm">{scheduleLabel}</dd>
              </div>
            )}
          </dl>
        )}
      </CardBody>
    </Card>
  );
}
