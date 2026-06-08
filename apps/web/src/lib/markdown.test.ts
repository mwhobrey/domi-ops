import { describe, expect, it } from "vitest";
import { markdownExcerpt } from "./markdown";

describe("markdownExcerpt", () => {
  it("strips bold and headings for preview text", () => {
    expect(markdownExcerpt("## Title\n\n**Hello** world")).toBe("Title Hello world");
  });

  it("truncates long plain text", () => {
    const long = "a".repeat(150);
    expect(markdownExcerpt(long, 120)).toBe(`${"a".repeat(120)}…`);
  });

  it("unwraps link labels", () => {
    expect(markdownExcerpt("[Docs](https://example.com)")).toBe("Docs");
  });
});
