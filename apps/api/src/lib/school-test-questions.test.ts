import { describe, expect, it } from "vitest";
import {
  defaultCorrectAnswer,
  sumExplicitPoints,
  validateQuestionInput,
  weightPercentages,
} from "./school-test-questions.js";

describe("validateQuestionInput", () => {
  it("requires prompt on create", () => {
    const result = validateQuestionInput(
      { questionType: "multiple_choice" },
      { pointsMode: "explicit", isCreate: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("prompt_required");
  });

  it("accepts explicit points", () => {
    const result = validateQuestionInput(
      {
        questionType: "true_false",
        promptMarkdown: "The sky is blue.",
        points: 2,
      },
      { pointsMode: "explicit", isCreate: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.points).toBe(2);
  });

  it("accepts weighted mode", () => {
    const result = validateQuestionInput(
      {
        questionType: "short_answer",
        promptMarkdown: "Name the capital.",
        weight: 3,
        correctAnswerJson: { accepted: ["Paris"] },
      },
      { pointsMode: "weighted", isCreate: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.weight).toBe(3);
      expect(result.value.points).toBeNull();
    }
  });

  it("rejects invalid mc correct option", () => {
    const result = validateQuestionInput(
      {
        questionType: "multiple_choice",
        promptMarkdown: "Pick one",
        correctAnswerJson: { optionId: "z" },
      },
      { pointsMode: "explicit", isCreate: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_correct_answer");
  });
});

describe("defaultCorrectAnswer", () => {
  it("returns tf default", () => {
    expect(defaultCorrectAnswer("true_false")).toEqual({ value: true });
  });
});

describe("points helpers", () => {
  it("sums explicit points", () => {
    expect(sumExplicitPoints([{ points: 2 }, { points: 3 }])).toBe(5);
  });

  it("calculates weight percentages", () => {
    expect(weightPercentages([{ weight: 1 }, { weight: 3 }])).toEqual([25, 75]);
  });
});
