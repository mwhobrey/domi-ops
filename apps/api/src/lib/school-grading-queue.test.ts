import { describe, expect, it } from "vitest";
import { gradableClassIds, submissionRecipientMemberIds } from "./school-grading-queue.js";

const classes = [
  { id: "math", teacherMemberId: "mom", archived: false },
  { id: "art", teacherMemberId: "dad", archived: false },
  { id: "old", teacherMemberId: "mom", archived: true },
];

describe("gradableClassIds", () => {
  it("gives household admins every non-archived class", () => {
    expect(
      gradableClassIds({ memberId: "mom", householdRole: "owner", classes, enrollments: [] }),
    ).toEqual(["math", "art"]);
  });

  it("limits a non-admin to classes they teach or are staff-enrolled in", () => {
    const enrollments = [{ classId: "art", role: "aide", activeFrom: null, activeTo: null }];
    expect(
      gradableClassIds({ memberId: "mom", householdRole: "member", classes, enrollments }),
    ).toEqual(["math", "art"]);
    expect(
      gradableClassIds({ memberId: "sam", householdRole: "child", classes, enrollments: [] }),
    ).toEqual([]);
  });

  it("gives students and observers nothing to grade", () => {
    const enrollments = [
      { classId: "math", role: "student", activeFrom: null, activeTo: null },
      { classId: "art", role: "observer", activeFrom: null, activeTo: null },
    ];
    expect(
      gradableClassIds({ memberId: "sam", householdRole: "child", classes, enrollments }),
    ).toEqual([]);
  });
});

describe("submissionRecipientMemberIds", () => {
  it("notifies the class teacher and active staff enrollments, not students", () => {
    const ids = submissionRecipientMemberIds({
      teacherMemberId: "mom",
      submitterMemberId: "sam",
      enrollments: [
        { memberId: "dad", role: "parent", activeFrom: null, activeTo: null },
        { memberId: "aide1", role: "aide", activeFrom: null, activeTo: null },
        { memberId: "sam", role: "student", activeFrom: null, activeTo: null },
        { memberId: "obs", role: "observer", activeFrom: null, activeTo: null },
      ],
    });
    expect(ids.sort()).toEqual(["aide1", "dad", "mom"]);
  });

  it("skips staff whose enrollment has ended and never notifies the submitter", () => {
    const ids = submissionRecipientMemberIds({
      teacherMemberId: "mom",
      submitterMemberId: "mom",
      enrollments: [{ memberId: "dad", role: "teacher", activeFrom: null, activeTo: "2020-01-01" }],
    });
    expect(ids).toEqual([]);
  });
});
