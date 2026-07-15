import { describe, expect, it } from "vitest";
import {
  normalizeShortAnswer,
  questionMaxPoints,
  rollupTestScore,
  scoreQuestion,
  type GradableQuestion,
} from "./school-test-grading.js";

const mc: GradableQuestion = {
  id: "q1",
  questionType: "multiple_choice",
  points: 2,
  weight: null,
  correctAnswerJson: { optionId: "a" },
};

const multi: GradableQuestion = {
  id: "q2",
  questionType: "multiple_choice_multi",
  points: 3,
  weight: null,
  correctAnswerJson: { optionIds: ["a", "c"] },
};

const tf: GradableQuestion = {
  id: "q3",
  questionType: "true_false",
  points: 1,
  weight: null,
  correctAnswerJson: { value: true },
};

const short: GradableQuestion = {
  id: "q4",
  questionType: "short_answer",
  points: 2,
  weight: null,
  correctAnswerJson: { accepted: ["Mitochondria", "the mitochondria"] },
};

const longQ: GradableQuestion = {
  id: "q5",
  questionType: "long_answer",
  points: 5,
  weight: null,
  correctAnswerJson: null,
};

describe("school-test-grading", () => {
  it("normalizes short answers case-insensitively", () => {
    expect(normalizeShortAnswer("  Hello\r\nWorld  ")).toBe("hello\nworld");
  });

  it("scores multiple choice", () => {
    expect(scoreQuestion(mc, { optionId: "a" }, "explicit", 10, [mc]).autoScore).toBe(2);
    expect(scoreQuestion(mc, { optionId: "b" }, "explicit", 10, [mc]).autoScore).toBe(0);
    expect(scoreQuestion(mc, {}, "explicit", 10, [mc]).autoScore).toBe(0);
  });

  it("scores multi-select with set equality", () => {
    expect(
      scoreQuestion(multi, { optionIds: ["c", "a"] }, "explicit", 10, [multi]).autoScore,
    ).toBe(3);
    expect(
      scoreQuestion(multi, { optionIds: ["a"] }, "explicit", 10, [multi]).autoScore,
    ).toBe(0);
  });

  it("scores true/false and short answer", () => {
    expect(scoreQuestion(tf, { value: true }, "explicit", 10, [tf]).autoScore).toBe(1);
    expect(scoreQuestion(short, { text: "mitochondria" }, "explicit", 10, [short]).autoScore).toBe(
      2,
    );
    expect(scoreQuestion(short, { text: "nucleus" }, "explicit", 10, [short]).autoScore).toBe(0);
  });

  it("leaves long answer for manual grade", () => {
    const result = scoreQuestion(longQ, { text: "essay" }, "explicit", 10, [longQ]);
    expect(result.autoScore).toBeNull();
    expect(result.needsManualGrade).toBe(true);
  });

  it("computes weighted max points", () => {
    const qs: GradableQuestion[] = [
      { ...mc, weight: 1, points: null },
      { ...tf, weight: 3, points: null },
    ];
    expect(questionMaxPoints(qs[0]!, "weighted", 100, qs)).toBe(25);
    expect(questionMaxPoints(qs[1]!, "weighted", 100, qs)).toBe(75);
  });

  it("rollups score or flags manual grade", () => {
    expect(
      rollupTestScore([
        { autoScore: 2, manualScore: null, needsManual: false },
        { autoScore: 0, manualScore: null, needsManual: false },
      ]),
    ).toEqual({ score: 2, needsManualGrade: false });

    expect(
      rollupTestScore([
        { autoScore: 2, manualScore: null, needsManual: false },
        { autoScore: null, manualScore: null, needsManual: true },
      ]),
    ).toEqual({ score: null, needsManualGrade: true });

    expect(
      rollupTestScore([
        { autoScore: 2, manualScore: null, needsManual: false },
        { autoScore: null, manualScore: 4, needsManual: true },
      ]),
    ).toEqual({ score: 6, needsManualGrade: false });
  });
});
