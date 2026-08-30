"use client";

import { Calendar, UserMinus, Users } from "lucide-react";
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
import { memberLabel, type Enrollment, type Member } from "../lib/school-class-types";
import { Alert, Avatar, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, Input, ListItem, SectionHeader, Select } from "./ui";

/** The "Roster" card on a class detail page — enroll/unenroll household members. Owns its own
 *  enrollment state so it's independent of the class-meta and assignments cards next to it. */
export function SchoolClassRosterCard({
  classId,
  initialEnrollments,
  members,
}: {
  classId: string;
  initialEnrollments: Enrollment[];
  members: Member[];
}) {
  const [enrollments, setEnrollments] = useState(initialEnrollments);
  const [memberId, setMemberId] = useState("");
  const [enrollRole, setEnrollRole] = useState("student");
  const [activeFrom, setActiveFrom] = useState("");
  const [activeTo, setActiveTo] = useState("");
  const [unenrollTarget, setUnenrollTarget] = useState<Enrollment | null>(null);
  const [unenrollLoading, setUnenrollLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enrolledIds = useMemo(() => new Set(enrollments.map((e) => e.memberId)), [enrollments]);
  const availableMembers = members.filter((m) => !enrolledIds.has(m.id));
  const defaultMemberId = availableMembers[0]?.id ?? "";
  const enrollMemberId = memberId || defaultMemberId;

  const sortedEnrollments = useMemo(() => {
    return [...enrollments].sort((a, b) => {
      const roleDiff = enrollmentRoleSortKey(a.role) - enrollmentRoleSortKey(b.role);
      if (roleDiff !== 0) return roleDiff;
      const labelA = memberLabel(members.find((m) => m.id === a.memberId), a.memberId);
      const labelB = memberLabel(members.find((m) => m.id === b.memberId), b.memberId);
      return labelA.localeCompare(labelB);
    });
  }, [enrollments, members]);

  const unenrollLabel = unenrollTarget
    ? memberLabel(members.find((m) => m.id === unenrollTarget.memberId), unenrollTarget.memberId)
    : "";

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
    <>
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
          {error && <Alert variant="error">{error}</Alert>}
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
              No household members found. Add members via Household settings or import.
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
                const dateLabel = formatEnrollmentActiveRange(en.activeFrom, en.activeTo, en.createdAt);
                const active = isEnrollmentActive(en.activeFrom, en.activeTo);
                return (
                  <ListItem key={en.id} as="li">
                    <Avatar id={en.memberId} name={label} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{label}</p>
                        <Badge tone={enrollmentRoleTone(en.role)}>{enrollmentRoleLabel(en.role)}</Badge>
                        {!active && <Badge tone="warning">Inactive</Badge>}
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
    </>
  );
}
