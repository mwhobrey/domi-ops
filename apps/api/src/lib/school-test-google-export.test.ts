import { describe, expect, it } from "vitest";
import {
  formatNativeTestHtml,
  formatNativeTestPlainText,
  type ExportableQuestion,
} from "./school-test-google-export.js";

const sample: ExportableQuestion[] = [
  {
    sortOrder: 0,
    questionType: "multiple_choice",
    promptMarkdown: "What is 2+2?",
    points: 1,
    weight: null,
    optionsJson: [
      { id: "a", label: "3" },
      { id: "b", label: "4" },
    ],
    correctAnswerJson: { optionId: "b" },
  },
  {
    sortOrder: 1,
    questionType: "true_false",
    promptMarkdown: "The sky is blue.",
    points: 1,
    weight: null,
    optionsJson: null,
    correctAnswerJson: { value: true },
  },
];

describe("school-test-google-export", () => {
  it("formats plain text with options and optional answer key", () => {
    const text = formatNativeTestPlainText({
      assignmentTitle: "Math 6",
      testTitle: "Quiz 1",
      questions: sample,
      includeAnswerKey: true,
    });
    expect(text).toContain("Math 6");
    expect(text).toContain("1. What is 2+2? (1 pt)");
    expect(text).toContain("a) 3");
    expect(text).toContain("____ True");
    expect(text).toContain("Answer Key");
    expect(text).toContain("b) 4");
    expect(text).toContain("True");
  });

  it("formats html without answer key when omitted", () => {
    const html = formatNativeTestHtml({
      assignmentTitle: "Math 6",
      testTitle: "Quiz 1",
      questions: sample,
      includeAnswerKey: false,
    });
    expect(html).toContain("<h1>Math 6</h1>");
    expect(html).not.toContain("Answer Key");
  });
});
