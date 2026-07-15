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

  it("scores multiple choice with raw explicit points when assignment total unset", () => {
    expect(scoreQuestion(mc, { optionId: "a" }, "explicit", null, [mc]).autoScore).toBe(2);
    expect(scoreQuestion(mc, { optionId: "b" }, "explicit", null, [mc]).autoScore).toBe(0);
    expect(scoreQuestion(mc, {}, "explicit", null, [mc]).autoScore).toBe(0);
  });

  it("scores multi-select with set equality", () => {
    expect(
      scoreQuestion(multi, { optionIds: ["c", "a"] }, "explicit", null, [multi]).autoScore,
    ).toBe(3);
    expect(
      scoreQuestion(multi, { optionIds: ["a"] }, "explicit", null, [multi]).autoScore,
    ).toBe(0);
  });

  it("scores true/false and short answer", () => {
    expect(scoreQuestion(tf, { value: true }, "explicit", null, [tf]).autoScore).toBe(1);
    expect(scoreQuestion(short, { text: "mitochondria" }, "explicit", null, [short]).autoScore).toBe(
      2,
    );
    expect(scoreQuestion(short, { text: "nucleus" }, "explicit", null, [short]).autoScore).toBe(0);
  });

  it("leaves long answer for manual grade", () => {
    const result = scoreQuestion(longQ, { text: "essay" }, "explicit", null, [longQ]);
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

  it("scales explicit points onto assignment total when set", () => {
    const qs: GradableQuestion[] = [
      { id: "a", questionType: "multiple_choice", points: 1, weight: null, correctAnswerJson: { optionId: "x" } },
      { id: "b", questionType: "multiple_choice", points: 1, weight: null, correctAnswerJson: { optionId: "x" } },
      { id: "c", questionType: "multiple_choice", points: 1, weight: null, correctAnswerJson: { optionId: "x" } },
      { id: "d", questionType: "multiple_choice", points: 1, weight: null, correctAnswerJson: { optionId: "x" } },
      { id: "e", questionType: "multiple_choice", points: 1, weight: null, correctAnswerJson: { optionId: "x" } },
    ];
    expect(questionMaxPoints(qs[0]!, "explicit", 100, qs)).toBe(20);
    const earned = qs.slice(0, 4).map((q) =>
      scoreQuestion(q, { optionId: "x" }, "explicit", 100, qs),
    );
    const missed = scoreQuestion(qs[4]!, { optionId: "y" }, "explicit", 100, qs);
    expect(
      rollupTestScore(
        [...earned, missed].map((r) => ({
          autoScore: r.autoScore,
          manualScore: null,
          needsManual: false,
        })),
      ),
    ).toEqual({ score: 80, needsManualGrade: false });
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
