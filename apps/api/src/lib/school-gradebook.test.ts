import { describe, expect, it } from "vitest";
import { gradebookCell } from "./school-gradebook.js";

const now = new Date("2026-09-23T15:00:00Z");
const pastDue = new Date("2026-06-01T12:00:00Z");

function cell(submissionStatus: string | null, score: number | null = null) {
  return gradebookCell({
    visibility: "assigned",
    dueAt: pastDue,
    pointsPossible: 100,
    submissionStatus,
    score,
    now,
  });
}

describe("gradebookCell", () => {
  it("marks untouched past-due work overdue and missing", () => {
    expect(cell(null)).toMatchObject({ status: "overdue", missing: true, overdue: true });
  });

  it("treats excused work as neither missing, overdue, nor scored", () => {
    expect(cell("excused")).toEqual({
      status: "excused",
      score: null,
      percent: null,
      missing: false,
      overdue: false,
    });
  });

  it("keeps submitted and graded work off the overdue list", () => {
    expect(cell("submitted")).toMatchObject({ status: "submitted", overdue: false });
    expect(cell("not_started", 90)).toMatchObject({ status: "graded", percent: 90 });
  });
});
