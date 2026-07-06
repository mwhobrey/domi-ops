import { describe, expect, it } from "vitest";
import {
  isSchoolStaffView,
  publishedAssignmentVisibilities,
  PUBLISHED_ASSIGNMENT_VISIBILITIES,
} from "./school-assignment-visibility.js";

describe("school-assignment-visibility", () => {
  it("published visibilities are assigned and closed only", () => {
    expect(publishedAssignmentVisibilities()).toEqual(["assigned", "closed"]);
    expect(PUBLISHED_ASSIGNMENT_VISIBILITIES).not.toContain("draft");
  });

  it("staff view includes admin, staff, and household admins", () => {
    expect(isSchoolStaffView("admin", "member")).toBe(true);
    expect(isSchoolStaffView("staff", "member")).toBe(true);
    expect(isSchoolStaffView("student", "owner")).toBe(true);
    expect(isSchoolStaffView("student", "admin")).toBe(true);
  });

  it("student and observer household members are not staff view", () => {
    expect(isSchoolStaffView("student", "member")).toBe(false);
    expect(isSchoolStaffView("observer", "member")).toBe(false);
  });
});
