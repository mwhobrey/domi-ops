import { describe, expect, it } from "vitest";
import { canSubmitPastDue, isSubmissionLate } from "./school-submission.js";

describe("isSubmissionLate", () => {
  it("is false without a due date", () => {
    expect(isSubmissionLate(null, new Date("2026-06-10T12:00:00Z"))).toBe(false);
  });

  it("is false when submitted on time", () => {
    expect(
      isSubmissionLate(
        new Date("2026-06-10T17:00:00Z"),
        new Date("2026-06-10T12:00:00Z"),
      ),
    ).toBe(false);
  });

  it("is true when submitted after due", () => {
    expect(
      isSubmissionLate(
        new Date("2026-06-10T12:00:00Z"),
        new Date("2026-06-11T08:00:00Z"),
      ),
    ).toBe(true);
  });
});

describe("canSubmitPastDue", () => {
  const dueAt = new Date("2026-06-10T12:00:00Z");
  const afterDue = new Date("2026-06-11T08:00:00Z");

  it("allows past-due first submit when allowLate is true", () => {
    expect(
      canSubmitPastDue({
        dueAt,
        allowLate: true,
        now: afterDue,
        existingStatus: "not_started",
      }),
    ).toEqual({ allowed: true });
  });

  it("blocks past-due first submit when allowLate is false", () => {
    expect(
      canSubmitPastDue({
        dueAt,
        allowLate: false,
        now: afterDue,
        existingStatus: "not_started",
      }),
    ).toEqual({ allowed: false, error: "late_not_allowed" });
  });

  it("allows updating an existing submission after due when allowLate is false", () => {
    expect(
      canSubmitPastDue({
        dueAt,
        allowLate: false,
        now: afterDue,
        existingStatus: "submitted",
      }),
    ).toEqual({ allowed: true });
  });
});
