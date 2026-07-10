import { describe, expect, it } from "vitest";
import { hashText, normalizeTextForHash } from "./school-material-freeze.js";

describe("school-material-freeze helpers", () => {
  it("normalizes text for hashing", () => {
    expect(normalizeTextForHash("  hello\r\nworld  ")).toBe("hello\nworld");
    expect(hashText("hello")).toHaveLength(64);
  });
});
