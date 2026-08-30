/**
 * Shared types + pure helpers for the class-detail cards (SchoolClassDetailsCard,
 * SchoolClassAssignmentsCard, SchoolClassRosterCard) — extracted out of the
 * SchoolClassDetail.tsx monolith (2026-08-30) so each card can import just what it needs
 * instead of all living in one 1768-line file.
 */

export interface Assignment {
  id: string;
  title: string;
  dueAt: string | null;
  visibility: string;
  pointsPossible?: number;
  instructionsHtml?: string;
  categoryId?: string | null;
  allowLate?: boolean;
  createdAt?: string;
}

export type AssignmentFilter = "all" | "assigned" | "draft" | "closed" | "no_due" | "overdue";
export type AssignmentSort = "due_asc" | "due_desc" | "title_asc" | "title_desc" | "created_desc";

export interface Enrollment {
  id: string;
  memberId: string;
  role: string;
  activeFrom: string | null;
  activeTo: string | null;
  createdAt: string;
}

export interface Member {
  id: string;
  shownLabel: string;
  email: string;
}

export interface ClassMeta {
  id: string;
  name: string;
  subject: string | null;
  term: string | null;
  teacherMemberId: string;
  scheduleJson: string | null;
  archived?: boolean;
}

export interface Category {
  id: string;
  name: string;
  weightPercent: number;
  gradingPolicy: string;
}

export const visibilityTone: Record<string, "default" | "accent" | "warning"> = {
  draft: "default",
  assigned: "accent",
  closed: "warning",
};

export function formatDue(dueAt: string): string {
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

export function memberLabel(member: Member | undefined, memberId: string): string {
  return member?.shownLabel ?? member?.email ?? memberId.slice(0, 8);
}
