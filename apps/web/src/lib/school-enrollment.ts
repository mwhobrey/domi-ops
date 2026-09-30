import { todayIsoInTimeZone } from "./household-date";

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

/**
 * Reduce a stored date to a plain YYYY-MM-DD. Enrollment dates are date-only strings and pass
 * through. A full timestamp (createdAt) is an instant, so it is read in the household timezone.
 * Never in the runtime's own zone: the server renders in UTC and the browser in the user's zone,
 * so a late-evening instant lands on different calendar days and React fails to hydrate.
 */
export function toCalendarDate(value: string, timeZone: string | null | undefined): string {
  if (!value.includes("T")) return value.slice(0, 10);
  return todayIsoInTimeZone(validZoneOrUtc(timeZone), new Date(value));
}

/**
 * A missing or unrecognised zone becomes UTC, not the device's zone. The device zone is exactly
 * what differs between the server and the browser, so falling back to it would bring the
 * hydration mismatch back for any household whose timezone hasn't loaded.
 */
export function validZoneOrUtc(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** "Sep 30, 2026" from a YYYY-MM-DD. Fixed locale and zone so server and browser agree. */
function formatCalendarDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatEnrollmentActiveRange(
  activeFrom: string | null | undefined,
  activeTo: string | null | undefined,
  createdAt: string | null | undefined,
  timeZone: string | null | undefined,
): string | null {
  const fmt = (value: string) => formatCalendarDate(toCalendarDate(value, timeZone));

  if (activeFrom && activeTo) return `${fmt(activeFrom)} – ${fmt(activeTo)}`;
  if (activeFrom) return `From ${fmt(activeFrom)}`;
  if (activeTo) return `Until ${fmt(activeTo)}`;
  if (createdAt) return `Enrolled ${fmt(createdAt)}`;
  return null;
}

/** Whether an enrollment covers `today` (a YYYY-MM-DD in the household timezone). */
export function isEnrollmentActive(
  activeFrom: string | null | undefined,
  activeTo: string | null | undefined,
  today: string,
): boolean {
  if (activeFrom && activeFrom.slice(0, 10) > today) return false;
  if (activeTo && activeTo.slice(0, 10) < today) return false;
  return true;
}
