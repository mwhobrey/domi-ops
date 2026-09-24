import { describe, expect, it } from "vitest";
import { mergeStudentWork, openWorkForAssignment, type StudentWorkState } from "./school-open-work.js";

const now = new Date("2026-09-23T15:00:00Z");
const weekAhead = new Date("2026-09-30T15:00:00Z");

function run(
  overrides: Partial<Parameters<typeof openWorkForAssignment>[0]> & {
    dueAt?: string;
    visibility?: string;
  } = {},
) {
  const { dueAt = "2026-06-01T12:00:00Z", visibility = "assigned", ...rest } = overrides;
  return openWorkForAssignment({
    assignment: { id: "a1", visibility, dueAt: new Date(dueAt), pointsPossible: 100 },
    studentIds: ["ally", "sam"],
    workByStudent: new Map<string, StudentWorkState>(),
    filter: "overdue",
    now,
    weekAhead,
    ...rest,
  });
}

describe("openWorkForAssignment", () => {
  it("lists only the students who haven't turned in past-due work", () => {
    const workByStudent = new Map<string, StudentWorkState>([
      ["ally", { submissionStatus: "submitted", score: null }],
    ]);
    expect(run({ workByStudent })).toEqual({ include: true, owedBy: ["sam"] });
  });

  it("drops past-due work once everyone has turned it in or been graded", () => {
    const workByStudent = new Map<string, StudentWorkState>([
      ["ally", { submissionStatus: "submitted", score: null }],
      ["sam", { submissionStatus: "not_started", score: 90 }],
    ]);
    expect(run({ workByStudent }).include).toBe(false);
  });

  it("drops closed assignments from both lists", () => {
    expect(run({ visibility: "closed" }).include).toBe(false);
    expect(run({ visibility: "closed", filter: "due", dueAt: "2026-09-25T12:00:00Z" }).include).toBe(
      false,
    );
  });

  it("never calls work overdue when no students are enrolled", () => {
    expect(run({ studentIds: [] }).include).toBe(false);
  });

  it("keeps upcoming work on the Due list, even with nobody enrolled", () => {
    expect(run({ filter: "due", dueAt: "2026-09-25T12:00:00Z" })).toEqual({
      include: true,
      owedBy: ["ally", "sam"],
    });
    expect(run({ filter: "due", dueAt: "2026-09-25T12:00:00Z", studentIds: [] }).include).toBe(true);
    expect(run({ filter: "due", dueAt: "2026-10-15T12:00:00Z" }).include).toBe(false);
  });
});

describe("mergeStudentWork", () => {
  it("keeps the furthest-along attempt and any score", () => {
    const merged = mergeStudentWork(
      { submissionStatus: "graded", score: 88 },
      { submissionStatus: "not_started", score: null },
    );
    expect(merged).toEqual({ submissionStatus: "graded", score: 88 });
    expect(
      mergeStudentWork({ submissionStatus: "not_started", score: null }, { submissionStatus: "submitted", score: null }),
    ).toEqual({ submissionStatus: "submitted", score: null });
  });
});
