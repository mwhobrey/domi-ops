"use client";



import {

  Calendar,

  ClipboardList,

  Clock,

  Pencil,

  Plus,

  UserMinus,

  Users,

} from "lucide-react";

import Link from "next/link";

import { useMemo, useState } from "react";

import { ApiError, apiClient } from "../lib/client-api";

import {

  ENROLLMENT_ROLES,

  enrollmentRoleLabel,

  enrollmentRoleSortKey,

  enrollmentRoleTone,

  formatEnrollmentActiveRange,

  isEnrollmentActive,

} from "../lib/school-enrollment";

import { formatClassSchedule, scheduleToJson } from "../lib/school-schedule";

import type { GradebookData } from "../lib/school-gradebook";
import type { SchoolClassAccess } from "../lib/school-access";

import { SchoolAssignmentSheet } from "./SchoolAssignmentSheet";

import { SchoolCategoryList } from "./SchoolCategoryList";

import { SchoolClassGradebookSection } from "./SchoolClassGradebook";

import {

  Alert,

  Avatar,

  Badge,

  Button,

  Card,

  CardBody,

  CardHeader,

  Checkbox,

  ConfirmDialog,

  EmptyState,

  Input,

  ListItem,

  SectionHeader,

  Select,

} from "./ui";



interface Assignment {

  id: string;

  title: string;

  dueAt: string | null;

  visibility: string;

  pointsPossible?: number;

  instructionsHtml?: string;

}



interface Enrollment {

  id: string;

  memberId: string;

  role: string;

  activeFrom: string | null;

  activeTo: string | null;

  createdAt: string;

}



interface Member {

  id: string;

  shownLabel: string;

  email: string;

}



interface ClassMeta {

  id: string;

  name: string;

  subject: string | null;

  term: string | null;

  teacherMemberId: string;

  scheduleJson: string | null;

  archived?: boolean;

}

interface Category {

  id: string;

  name: string;

  weightPercent: number;

  gradingPolicy: string;

}



const visibilityTone: Record<string, "default" | "accent" | "warning"> = {

  draft: "default",

  assigned: "accent",

  closed: "warning",

};



function formatDue(dueAt: string): string {

  const due = new Date(dueAt);

  const now = new Date();

  const overdue = due < now;

  const label = due.toLocaleDateString(undefined, {

    weekday: "short",

    month: "short",

    day: "numeric",

  });

  return overdue ? `${label} · overdue` : label;

}



function memberLabel(member: Member | undefined, memberId: string): string {

  return member?.shownLabel ?? member?.email ?? memberId.slice(0, 8);

}



export function SchoolClassDetail({

  classId,

  initialClass,

  initialAssignments,

  initialEnrollments,

  initialGradebook,

  initialCategories,

  members,

  access,

  currentMemberId,

}: {

  classId: string;

  initialClass: ClassMeta;

  initialAssignments: Assignment[];

  initialEnrollments: Enrollment[];

  initialGradebook: GradebookData;

  initialCategories: Category[];

  members: Member[];

  access: SchoolClassAccess;

  currentMemberId: string;

}) {

  const canManage = access.canManage;
  const canEditAssignments = access.canEditAssignments;
  const canViewRoster = access.canViewRoster;
  const canEditCategories = access.canEditCategories;
  const canEditClassMeta = access.canEditClassMeta;
  const canViewFullGradebook = access.canViewFullGradebook;

  const studentGradebook: GradebookData =
    access.viewMode === "student"
      ? {
          ...initialGradebook,
          students: initialGradebook.students.filter((s) => s.memberId === currentMemberId),
          summary: (() => {
            const me = initialGradebook.students.find((s) => s.memberId === currentMemberId);
            return {
              ...initialGradebook.summary,
              studentCount: me ? 1 : 0,
              missingTotal: me?.missingCount ?? 0,
              overdueTotal: me?.overdueCount ?? 0,
              gradedTotal: me?.gradedCount ?? 0,
              classAveragePercent: me?.averagePercent ?? null,
            };
          })(),
        }
      : initialGradebook;

  const [classMeta, setClassMeta] = useState(initialClass);

  const [assignments, setAssignments] = useState(initialAssignments);

  const [enrollments, setEnrollments] = useState(initialEnrollments);

  const [assignmentSheetOpen, setAssignmentSheetOpen] = useState(false);

  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);

  const [memberId, setMemberId] = useState("");

  const [enrollRole, setEnrollRole] = useState("student");

  const [activeFrom, setActiveFrom] = useState("");

  const [activeTo, setActiveTo] = useState("");

  const [error, setError] = useState<string | null>(null);

  const [editingMeta, setEditingMeta] = useState(false);

  const [metaTerm, setMetaTerm] = useState(classMeta.term ?? "");

  const [metaTeacherId, setMetaTeacherId] = useState(classMeta.teacherMemberId);

  const [metaSchedule, setMetaSchedule] = useState(

    formatClassSchedule(classMeta.scheduleJson) ?? "",

  );

  const [metaArchived, setMetaArchived] = useState(classMeta.archived ?? false);

  const [metaSaving, setMetaSaving] = useState(false);

  const [unenrollTarget, setUnenrollTarget] = useState<Enrollment | null>(null);

  const [unenrollLoading, setUnenrollLoading] = useState(false);



  const teacher = members.find((m) => m.id === classMeta.teacherMemberId);

  const scheduleLabel = formatClassSchedule(classMeta.scheduleJson);



  const enrolledIds = useMemo(() => new Set(enrollments.map((e) => e.memberId)), [enrollments]);

  const availableMembers = members.filter((m) => !enrolledIds.has(m.id));



  const defaultMemberId = availableMembers[0]?.id ?? "";

  const enrollMemberId = memberId || defaultMemberId;



  const sortedEnrollments = useMemo(() => {

    return [...enrollments].sort((a, b) => {

      const roleDiff = enrollmentRoleSortKey(a.role) - enrollmentRoleSortKey(b.role);

      if (roleDiff !== 0) return roleDiff;

      const labelA = memberLabel(

        members.find((m) => m.id === a.memberId),

        a.memberId,

      );

      const labelB = memberLabel(

        members.find((m) => m.id === b.memberId),

        b.memberId,

      );

      return labelA.localeCompare(labelB);

    });

  }, [enrollments, members]);



  const unenrollLabel = unenrollTarget

    ? memberLabel(

        members.find((m) => m.id === unenrollTarget.memberId),

        unenrollTarget.memberId,

      )

    : "";



  async function saveMeta() {

    setMetaSaving(true);

    setError(null);

    try {

      const data = await apiClient.patch<{ class: ClassMeta }>(`/api/school/classes/${classId}`, {

        term: metaTerm.trim() || null,

        teacherMemberId: metaTeacherId,

        scheduleJson: scheduleToJson(metaSchedule),

        archived: metaArchived,

      });

      setClassMeta((prev) => ({ ...prev, ...data.class }));

      setEditingMeta(false);

    } catch (err) {

      setError(err instanceof ApiError ? err.message : "Failed to update class");

    } finally {

      setMetaSaving(false);

    }

  }



  async function confirmUnenroll() {

    if (!unenrollTarget) return;

    setUnenrollLoading(true);

    setError(null);

    try {

      await apiClient.delete(`/api/school/enrollments/${unenrollTarget.id}`);

      setEnrollments((prev) => prev.filter((e) => e.id !== unenrollTarget.id));

      setUnenrollTarget(null);

    } catch (err) {

      setError(err instanceof ApiError ? err.message : "Failed to remove enrollment");

    } finally {

      setUnenrollLoading(false);

    }

  }



  return (

    <div className="space-y-8">

      {error && <Alert variant="error">{error}</Alert>}



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

                      <Avatar

                        id={teacher.id}

                        name={teacher.shownLabel || teacher.email}

                        size="sm"

                      />

                      <span>{teacher.shownLabel || teacher.email}</span>

                    </>

                  ) : (

                    <span className="text-[var(--color-text-muted)]">Unknown</span>

                  )}

                </dd>

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



      <Card>

        <CardHeader>

          <SectionHeader title="Progress" />

        </CardHeader>

        <CardBody>

          <SchoolClassGradebookSection

            classId={classId}

            gradebook={studentGradebook}

            members={members}

            showFullGradebookLink={canViewFullGradebook}

          />

        </CardBody>

      </Card>



      <Card>

        <CardHeader>

          <SectionHeader

            title="Assignments"

            action={

              canEditAssignments ? (

                <Button

                  type="button"

                  size="sm"

                  onClick={() => {

                    setEditingAssignment(null);

                    setAssignmentSheetOpen(true);

                  }}

                >

                  <Plus className="h-4 w-4" aria-hidden />

                  New assignment

                </Button>

              ) : null

            }

          />

        </CardHeader>

        <CardBody>

          {assignments.length === 0 ? (

            <EmptyState

              title="No assignments"

              description={
                canEditAssignments
                  ? "Create the first assignment for this class."
                  : "No assignments published yet."
              }

              icon={<ClipboardList className="h-10 w-10" aria-hidden />}

            />

          ) : (

            <ul className="space-y-2" aria-label="Assignments">

              {assignments.map((a) => (

                <li key={a.id}>

                  <ListItem as="div" className="hover:border-[var(--color-accent)]/40">

                    <Link

                      href={`/school/assignment/${a.id}`}

                      className="min-w-0 flex-1 rounded-[var(--radius-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"

                    >

                      <p className="truncate font-medium text-[var(--color-accent)]">{a.title}</p>

                      <div className="mt-1 flex flex-wrap items-center gap-2">

                        <Badge tone={visibilityTone[a.visibility] ?? "default"}>

                          {a.visibility}

                        </Badge>

                        {a.dueAt && (

                          <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">

                            <Calendar className="h-3 w-3" aria-hidden />

                            {formatDue(a.dueAt)}

                          </span>

                        )}

                        {a.pointsPossible != null && (

                          <span className="text-xs text-[var(--color-text-muted)]">

                            {a.pointsPossible} pts

                          </span>

                        )}

                      </div>

                    </Link>

                    {canEditAssignments ? (
                      <Button

                        type="button"

                        variant="ghost"

                        size="sm"

                        onClick={() => {

                          setEditingAssignment(a);

                          setAssignmentSheetOpen(true);

                        }}

                        aria-label={`Edit ${a.title}`}

                      >

                        <Pencil className="h-4 w-4" aria-hidden />

                      </Button>
                    ) : null}

                  </ListItem>

                </li>

              ))}

            </ul>

          )}

        </CardBody>

      </Card>



      {(canEditCategories || initialCategories.length > 0) && (
      <Card>

        <CardHeader>

          <SectionHeader title="Grade categories" />

        </CardHeader>

        <CardBody>

          <SchoolCategoryList
            classId={classId}
            initialCategories={initialCategories}
            readOnly={!canEditCategories}
          />

        </CardBody>

      </Card>
      )}



      {canViewRoster && (
      <Card>

        <CardHeader>

          <SectionHeader

            title="Roster"

            action={

              enrollments.length > 0 ? (

                <Badge tone="default">

                  {enrollments.length} {enrollments.length === 1 ? "member" : "members"}

                </Badge>

              ) : null

            }

          />

        </CardHeader>

        <CardBody>

          {availableMembers.length > 0 ? (

            <form

              className="mb-4 space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)]/60 bg-[var(--color-surface)]/40 p-4"

              onSubmit={async (e) => {

                e.preventDefault();

                if (!enrollMemberId) return;

                setError(null);

                try {

                  const data = await apiClient.post<{ enrollment: Enrollment }>(

                    `/api/school/classes/${classId}/enrollments`,

                    {

                      memberId: enrollMemberId,

                      role: enrollRole,

                      activeFrom: activeFrom || null,

                      activeTo: activeTo || null,

                    },

                  );

                  setEnrollments((prev) => [...prev, data.enrollment]);

                  setMemberId("");

                  setEnrollRole("student");

                  setActiveFrom("");

                  setActiveTo("");

                } catch (err) {

                  setError(err instanceof ApiError ? err.message : "Failed to enroll");

                }

              }}

            >

              <p className="text-sm font-medium">Add to roster</p>

              <div className="grid gap-3 sm:grid-cols-2">

                <div>

                  <label htmlFor="enroll-member" className="text-label text-[var(--color-text-muted)]">

                    Household member

                  </label>

                  <Select

                    id="enroll-member"

                    value={enrollMemberId}

                    onChange={(e) => setMemberId(e.target.value)}

                    className="mt-1 w-full"

                  >

                    {availableMembers.map((m) => (

                      <option key={m.id} value={m.id}>

                        {m.shownLabel || m.email}

                      </option>

                    ))}

                  </Select>

                </div>

                <div>

                  <label htmlFor="enroll-role" className="text-label text-[var(--color-text-muted)]">

                    Role

                  </label>

                  <Select

                    id="enroll-role"

                    value={enrollRole}

                    onChange={(e) => setEnrollRole(e.target.value)}

                    className="mt-1 w-full"

                  >

                    {ENROLLMENT_ROLES.map((r) => (

                      <option key={r.value} value={r.value}>

                        {r.label}

                      </option>

                    ))}

                  </Select>

                </div>

                <div>

                  <label htmlFor="enroll-from" className="text-label text-[var(--color-text-muted)]">

                    Active from <span className="font-normal">(optional)</span>

                  </label>

                  <Input

                    id="enroll-from"

                    type="date"

                    className="mt-1"

                    value={activeFrom}

                    onChange={(e) => setActiveFrom(e.target.value)}

                  />

                </div>

                <div>

                  <label htmlFor="enroll-to" className="text-label text-[var(--color-text-muted)]">

                    Active until <span className="font-normal">(optional)</span>

                  </label>

                  <Input

                    id="enroll-to"

                    type="date"

                    className="mt-1"

                    value={activeTo}

                    onChange={(e) => setActiveTo(e.target.value)}

                  />

                </div>

              </div>

              <Button type="submit">Enroll member</Button>

            </form>

          ) : members.length === 0 ? (

            <p className="mb-4 text-sm text-[var(--color-text-muted)]">

              No household members found. Add members via profile and import.

            </p>

          ) : (

            <p className="mb-4 text-sm text-[var(--color-text-muted)]">

              All household members are enrolled in this class.

            </p>

          )}

          {enrollments.length === 0 ? (

            <EmptyState

              title="No one enrolled yet"

              description="Add household members to this class to track assignments, submissions, and grades."

              icon={<Users className="h-10 w-10" aria-hidden />}

            />

          ) : (

            <ul className="space-y-2" aria-label="Enrolled members">

              {sortedEnrollments.map((en) => {

                const member = members.find((m) => m.id === en.memberId);

                const label = memberLabel(member, en.memberId);

                const dateLabel = formatEnrollmentActiveRange(

                  en.activeFrom,

                  en.activeTo,

                  en.createdAt,

                );

                const active = isEnrollmentActive(en.activeFrom, en.activeTo);

                return (

                  <ListItem key={en.id} as="li">

                    <Avatar id={en.memberId} name={label} size="md" />

                    <div className="min-w-0 flex-1">

                      <div className="flex flex-wrap items-center gap-2">

                        <p className="truncate font-medium">{label}</p>

                        <Badge tone={enrollmentRoleTone(en.role)}>

                          {enrollmentRoleLabel(en.role)}

                        </Badge>

                        {!active && (

                          <Badge tone="warning">Inactive</Badge>

                        )}

                      </div>

                      {dateLabel && (

                        <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">

                          <Calendar className="h-3 w-3 shrink-0" aria-hidden />

                          {dateLabel}

                        </p>

                      )}

                    </div>

                    <Button

                      type="button"

                      variant="ghost"

                      size="sm"

                      onClick={() => setUnenrollTarget(en)}

                      aria-label={`Remove ${label} from roster`}

                    >

                      <UserMinus className="h-4 w-4" aria-hidden />

                      <span className="sr-only">Remove</span>

                    </Button>

                  </ListItem>

                );

              })}

            </ul>

          )}

        </CardBody>

      </Card>
      )}



      <ConfirmDialog

        open={unenrollTarget !== null}

        title="Remove from roster?"

        message={

          unenrollTarget

            ? `${unenrollLabel} will be unenrolled from this class. Their assignment submissions and grades are not deleted.`

            : ""

        }

        confirmLabel="Remove"

        loading={unenrollLoading}

        onConfirm={() => void confirmUnenroll()}

        onCancel={() => {

          if (!unenrollLoading) setUnenrollTarget(null);

        }}

      />



      <SchoolAssignmentSheet

        open={assignmentSheetOpen}

        onClose={() => {

          setAssignmentSheetOpen(false);

          setEditingAssignment(null);

        }}

        classId={classId}

        assignment={editingAssignment}

        categories={initialCategories}

        onSaved={(saved) => {

          setAssignments((prev) => {

            const idx = prev.findIndex((a) => a.id === saved.id);

            if (idx >= 0) {

              const next = [...prev];

              next[idx] = { ...next[idx], ...saved };

              return next;

            }

            return [saved, ...prev];

          });

        }}

      />

    </div>

  );

}


