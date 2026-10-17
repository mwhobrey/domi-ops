import { describe, expect, it } from "vitest";
import { isEnrollmentActiveNow, resolveClassAccess } from "./school-access.js";
import { withHouseholdDate } from "./household-date-context.js";

describe("inclusive enrollment calendar dates", () => {
  it("includes both boundaries and excludes surrounding dates", () => {
    expect(isEnrollmentActiveNow("2026-10-16", "2026-10-17", "2026-10-16")).toBe(true);
    expect(isEnrollmentActiveNow("2026-10-16", "2026-10-17", "2026-10-17")).toBe(true);
    expect(isEnrollmentActiveNow("2026-10-16", "2026-10-17", "2026-10-15")).toBe(false);
    expect(isEnrollmentActiveNow("2026-10-16", "2026-10-17", "2026-10-18")).toBe(false);
  });
  it("uses the household day through the access resolver and isolates concurrent requests", async () => {
    const access = () => resolveClassAccess({ memberId: "student", householdRole: "child", teacherMemberId: "teacher", enrollment: { role: "student", activeFrom: "2026-10-16", activeTo: "2026-10-16" } }).canSubmit;
    const results = await Promise.all([
      withHouseholdDate("2026-10-16", async () => { await Promise.resolve(); return access(); }),
      withHouseholdDate("2026-10-15", async () => { await Promise.resolve(); return access(); }),
    ]);
    expect(results).toEqual([true, false]);
  });
  it("accepts unbounded dates and refuses malformed boundaries", () => {
    expect(isEnrollmentActiveNow(null, null, "2026-10-16")).toBe(true);
    expect(isEnrollmentActiveNow("invalid", null, "2026-10-16")).toBe(false);
    expect(isEnrollmentActiveNow("2026-02-30", null, "2026-10-16")).toBe(false);
    expect(isEnrollmentActiveNow(new Date("2026-10-16T00:00:00Z"), null, "2026-10-16")).toBe(true);
  });
});
