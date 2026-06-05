type BadgeTone = "default" | "success" | "warning" | "accent";

export const ENROLLMENT_ROLES = [
  { value: "student", label: "Student" },
  { value: "teacher", label: "Teacher" },
  { value: "parent", label: "Parent" },
  { value: "aide", label: "Aide" },
  { value: "observer", label: "Observer" },
] as const;

export type EnrollmentRole = (typeof ENROLLMENT_ROLES)[number]["value"];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ENROLLMENT_ROLES.map((r) => [r.value, r.label]),
);

const ROLE_TONE: Record<string, BadgeTone> = {
  student: "accent",
  teacher: "success",
  parent: "default",
  aide: "warning",
  observer: "default",
};

const ROLE_SORT: Record<string, number> = {
  teacher: 0,
  aide: 1,
  parent: 2,
  student: 3,
  observer: 4,
};

export function enrollmentRoleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

export function enrollmentRoleTone(role: string): BadgeTone {
  return ROLE_TONE[role] ?? "default";
}

export function enrollmentRoleSortKey(role: string): number {
  return ROLE_SORT[role] ?? 99;
}

export function formatEnrollmentActiveRange(
  activeFrom: string | null | undefined,
  activeTo: string | null | undefined,
  createdAt?: string | null,
): string | null {
  const fmt = (iso: string) =>
    new Date(iso.includes("T") ? iso : `${iso}T12:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  if (activeFrom && activeTo) return `${fmt(activeFrom)} – ${fmt(activeTo)}`;
  if (activeFrom) return `From ${fmt(activeFrom)}`;
  if (activeTo) return `Until ${fmt(activeTo)}`;
  if (createdAt) return `Enrolled ${fmt(createdAt)}`;
  return null;
}

export function isEnrollmentActive(
  activeFrom: string | null | undefined,
  activeTo: string | null | undefined,
): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (activeFrom) {
    const from = new Date(`${activeFrom}T12:00:00`);
    if (from > today) return false;
  }
  if (activeTo) {
    const to = new Date(`${activeTo}T12:00:00`);
    if (to < today) return false;
  }
  return true;
}
