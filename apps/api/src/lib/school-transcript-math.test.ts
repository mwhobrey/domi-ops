import { describe, expect, it } from "vitest";
import { buildTranscript, gradeCourse, letterGrade } from "./school-transcript-math.js";

const course = (over: Partial<Parameters<typeof gradeCourse>[0]> = {}) => ({
  classId: "c1",
  name: "Algebra",
  subject: "Math",
  term: "2025-2026",
  credits: 1,
  finalPercent: 95 as number | null,
  ...over,
});

describe("letterGrade", () => {
  it("uses the standard boundaries", () => {
    expect(letterGrade(100)).toBe("A");
    expect(letterGrade(90)).toBe("A");
    expect(letterGrade(89.9)).toBe("B");
    expect(letterGrade(80)).toBe("B");
    expect(letterGrade(70)).toBe("C");
    expect(letterGrade(60)).toBe("D");
    expect(letterGrade(59.9)).toBe("F");
  });
});

describe("gradeCourse", () => {
  it("awards credit for a passing grade", () => {
    expect(gradeCourse(course({ finalPercent: 62, credits: 0.5 }))).toMatchObject({
      letter: "D",
      gradePoints: 1,
      creditsAttempted: 0.5,
      creditsEarned: 0.5,
      inProgress: false,
    });
  });

  it("attempts but does not earn credit on an F", () => {
    expect(gradeCourse(course({ finalPercent: 40 }))).toMatchObject({
      letter: "F",
      gradePoints: 0,
      creditsAttempted: 1,
      creditsEarned: 0,
    });
  });

  it("leaves an ungraded course in progress with no credit or GPA effect", () => {
    expect(gradeCourse(course({ finalPercent: null }))).toMatchObject({
      letter: null,
      gradePoints: null,
      creditsAttempted: 0,
      creditsEarned: 0,
      inProgress: true,
    });
  });
});

describe("buildTranscript", () => {
  it("weights GPA by credits", () => {
    const t = buildTranscript([
      course({ classId: "a", name: "Algebra", finalPercent: 95, credits: 1 }), // A, 4.0
      course({ classId: "b", name: "Art", finalPercent: 75, credits: 0.5 }), // C, 2.0
    ]);
    // (4*1 + 2*0.5) / 1.5 = 3.33
    expect(t.gpa).toBe(3.33);
    expect(t.creditsAttempted).toBe(1.5);
    expect(t.creditsEarned).toBe(1.5);
  });

  it("groups by term in order, with unassigned last", () => {
    const t = buildTranscript([
      course({ classId: "a", term: null, name: "Elective" }),
      course({ classId: "b", term: "2025-2026", name: "Biology" }),
      course({ classId: "c", term: "2024-2025", name: "Latin" }),
    ]);
    expect(t.terms.map((x) => x.term)).toEqual(["2024-2025", "2025-2026", null]);
  });

  it("computes per-term GPA separately from cumulative", () => {
    const t = buildTranscript([
      course({ classId: "a", term: "2024-2025", finalPercent: 95 }),
      course({ classId: "b", term: "2025-2026", finalPercent: 75 }),
    ]);
    expect(t.terms[0]!.gpa).toBe(4);
    expect(t.terms[1]!.gpa).toBe(2);
    expect(t.gpa).toBe(3);
  });

  it("returns a null GPA when nothing is graded", () => {
    const t = buildTranscript([course({ finalPercent: null })]);
    expect(t.gpa).toBeNull();
    expect(t.creditsEarned).toBe(0);
    expect(t.terms[0]!.courses[0]!.inProgress).toBe(true);
  });

  it("handles no courses", () => {
    expect(buildTranscript([])).toEqual({ terms: [], creditsAttempted: 0, creditsEarned: 0, gpa: null });
  });
});
