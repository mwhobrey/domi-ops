import type { SchoolViewMode } from "./school-access.js";
import { isHouseholdAdmin } from "./school-access.js";

/** Published assignments — shown on calendar, weekly schedule, and school glance. */
export const PUBLISHED_ASSIGNMENT_VISIBILITIES = ["assigned", "closed"] as const;

export type PublishedAssignmentVisibility = (typeof PUBLISHED_ASSIGNMENT_VISIBILITIES)[number];

/** Staff/admin see class-wide assignment data; students see enrolled classes only. */
export function isSchoolStaffView(viewMode: SchoolViewMode, householdRole: string): boolean {
  return isHouseholdAdmin(householdRole) || viewMode === "admin" || viewMode === "staff";
}

export function publishedAssignmentVisibilities(): PublishedAssignmentVisibility[] {
  return [...PUBLISHED_ASSIGNMENT_VISIBILITIES];
}
