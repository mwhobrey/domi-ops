import { describe, expect, it } from "vitest";
import { parseGoogleDocTestText } from "./school-test-google-import.js";

const SAMPLE = `Unit Quiz

1. What is photosynthesis? (2 pts)
a) Making food from sunlight
b) Breathing
c) Digestion
Answer: a

2. True or False: Water is H2O
Answer: True

3. Name the powerhouse of the cell.
Answer: mitochondria

4. Explain why plants need sunlight.



Answer Key
1. a
2. True
3. mitochondria
`;

describe("school-test-google-import", () => {
  it("parses numbered MC, TF, short, and long questions", () => {
    const { questions, warnings } = parseGoogleDocTestText(SAMPLE);
    expect(questions).toHaveLength(4);
    expect(questions[0]?.questionType).toBe("multiple_choice");
    expect(questions[0]?.correctAnswerJson).toEqual({ optionId: "a" });
    expect(questions[0]?.points).toBe(2);
    expect(questions[1]?.questionType).toBe("true_false");
    expect(questions[1]?.correctAnswerJson).toEqual({ value: true });
    expect(questions[2]?.questionType).toBe("short_answer");
    expect(questions[3]?.questionType).toBe("long_answer");
    expect(questions[3]?.needsReview).toBe(true);
    expect(warnings.some((w) => w.includes("need teacher review"))).toBe(true);
  });

  it("falls back when no numbered questions", () => {
    const { questions } = parseGoogleDocTestText("Just freeform notes about the chapter.");
    expect(questions).toHaveLength(1);
    expect(questions[0]?.questionType).toBe("long_answer");
    expect(questions[0]?.needsReview).toBe(true);
  });

  it("never fabricates an answer key for ambiguous multiple choice", () => {
    const { questions } = parseGoogleDocTestText(`
1. Pick the best answer
a) Alpha
b) Beta
`);
    expect(questions[0]?.questionType).toBe("multiple_choice");
    expect(questions[0]?.correctAnswerJson).toBeNull();
    expect(questions[0]?.needsReview).toBe(true);
  });
});
