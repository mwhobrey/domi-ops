import { describe, expect, it } from "vitest";
import {
  buildTranscript,
  DEFAULT_GRADE_SCALE,
  GRADE_SCALE_PRESETS,
  gradeCourse,
  gradeFor,
  scaleOrDefault,
  validateGradeScale,
  type GradeScale,
} from "./school-transcript-math.js";

const preset = (id: string): GradeScale => GRADE_SCALE_PRESETS.find((p) => p.id === id)!.scale;

const course = (over: Partial<Parameters<typeof gradeCourse>[0]> = {}) => ({
  classId: "c1",
  name: "Algebra",
  subject: "Math",
  term: "2025-2026",
  credits: 1,
  finalPercent: 95 as number | null,
  ...over,
});

describe("gradeFor", () => {
  it("uses the standard boundaries by default", () => {
    const letter = (p: number) => gradeFor(p, DEFAULT_GRADE_SCALE).letter;
    expect(letter(100)).toBe("A");
    expect(letter(90)).toBe("A");
    expect(letter(89.9)).toBe("B");
    expect(letter(60)).toBe("D");
    expect(letter(59.9)).toBe("F");
  });

  it("gives the same percent a different grade on different scales", () => {
    expect(gradeFor(91, preset("standard")).letter).toBe("A");
    expect(gradeFor(91, preset("plus-minus")).letter).toBe("A-");
    expect(gradeFor(91, preset("seven-point")).letter).toBe("B");
    expect(gradeFor(91, preset("plus-minus")).points).toBe(3.7);
  });

  it("is order-independent", () => {
    const shuffled: GradeScale = { ...DEFAULT_GRADE_SCALE, bands: [...DEFAULT_GRADE_SCALE.bands].reverse() };
    expect(gradeFor(85, shuffled).letter).toBe("B");
  });
});

describe("gradeCourse", () => {
  it("awards credit at or above the passing percent", () => {
    expect(gradeCourse(course({ finalPercent: 62, credits: 0.5 }))).toMatchObject({
      letter: "D",
      gradePoints: 1,
      creditsAttempted: 0.5,
      creditsEarned: 0.5,
    });
  });

  it("follows the scale's own passing percent", () => {
    // On the 7-point scale, 65% is an F and earns nothing; on the standard scale it is a D and does.
    expect(gradeCourse(course({ finalPercent: 65 }), preset("seven-point"))).toMatchObject({
      letter: "F",
      creditsEarned: 0,
      creditsAttempted: 1,
    });
    expect(gradeCourse(course({ finalPercent: 65 }))).toMatchObject({ letter: "D", creditsEarned: 1 });
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
    expect(t.gpa).toBe(3.33);
    expect(t.creditsAttempted).toBe(1.5);
    expect(t.creditsEarned).toBe(1.5);
  });

  it("changes GPA with the scale", () => {
    const courses = [course({ finalPercent: 91 })];
    expect(buildTranscript(courses, preset("standard")).gpa).toBe(4);
    expect(buildTranscript(courses, preset("plus-minus")).gpa).toBe(3.7);
    expect(buildTranscript(courses, preset("seven-point")).gpa).toBe(3);
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

  it("returns a null GPA when nothing is graded, and handles no courses", () => {
    expect(buildTranscript([course({ finalPercent: null })]).gpa).toBeNull();
    expect(buildTranscript([])).toEqual({ terms: [], creditsAttempted: 0, creditsEarned: 0, gpa: null });
  });
});

describe("validateGradeScale", () => {
  const ok = { passingPercent: 60, bands: [{ min: 50, letter: "P", points: 1 }, { min: 0, letter: "NP", points: 0 }] };

  it("accepts every preset and a custom pass/fail scale", () => {
    for (const p of GRADE_SCALE_PRESETS) expect("scale" in validateGradeScale(p.scale)).toBe(true);
    expect("scale" in validateGradeScale(ok)).toBe(true);
  });

  it("sorts bands high to low and trims labels", () => {
    const res = validateGradeScale({ passingPercent: 50, bands: [{ min: 0, letter: " F ", points: 0 }, { min: 50, letter: "P", points: 1 }] });
    expect(res).toEqual({ scale: { passingPercent: 50, bands: [{ min: 50, letter: "P", points: 1 }, { min: 0, letter: "F", points: 0 }] } });
  });

  it.each([
    ["not an object", "nope"],
    ["missing bands", { passingPercent: 60 }],
    ["one band", { passingPercent: 60, bands: [{ min: 0, letter: "A", points: 4 }] }],
    ["no band at 0", { passingPercent: 60, bands: [{ min: 90, letter: "A", points: 4 }, { min: 50, letter: "F", points: 0 }] }],
    ["duplicate percent", { passingPercent: 60, bands: [{ min: 0, letter: "F", points: 0 }, { min: 0, letter: "X", points: 0 }] }],
    ["percent out of range", { passingPercent: 60, bands: [{ min: 0, letter: "F", points: 0 }, { min: 101, letter: "A", points: 4 }] }],
    ["bad passing percent", { passingPercent: 150, bands: ok.bands }],
    ["empty label", { passingPercent: 60, bands: [{ min: 0, letter: " ", points: 0 }, { min: 50, letter: "P", points: 1 }] }],
    ["negative points", { passingPercent: 60, bands: [{ min: 0, letter: "F", points: -1 }, { min: 50, letter: "P", points: 1 }] }],
  ])("rejects %s", (_name, input) => {
    expect("error" in validateGradeScale(input)).toBe(true);
  });
});

describe("scaleOrDefault", () => {
  it("falls back to the default for null or garbage", () => {
    expect(scaleOrDefault(null)).toBe(DEFAULT_GRADE_SCALE);
    expect(scaleOrDefault({ nonsense: true })).toBe(DEFAULT_GRADE_SCALE);
  });
  it("uses a valid stored scale", () => {
    expect(scaleOrDefault(preset("seven-point")).passingPercent).toBe(70);
  });
});
