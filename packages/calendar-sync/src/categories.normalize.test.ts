import { describe, expect, it } from "vitest";
import { normalizeCategorySourceKey } from "./categories.js";

describe("normalizeCategorySourceKey", () => {
  it("collapses preset and event-type variants", () => {
    expect(normalizeCategorySourceKey("focusTime")).toBe("focustime");
    expect(normalizeCategorySourceKey("Focus Time")).toBe("focus_time");
  });
});
