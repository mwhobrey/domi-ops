import { describe, expect, it } from "vitest";
import { normalizeTitle } from "./google-event-match.js";

describe("normalizeTitle (fuzzy dedup)", () => {
  it("treats equivalent titles as the same", () => {
    expect(normalizeTitle("  Soccer   Practice ")).toBe("soccer practice");
  });
});
