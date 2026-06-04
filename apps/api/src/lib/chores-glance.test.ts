import { describe, expect, it } from "vitest";
import { buildChoresGlance } from "./chores-glance.js";

describe("buildChoresGlance", () => {
  it("orders overdue before due today", () => {
    const result = buildChoresGlance(
      [
        { id: "1", description: "Today task", dueDate: "2026-06-04", done: false },
        { id: "2", description: "Late task", dueDate: "2026-06-01", done: false },
      ],
      "2026-06-04",
    );
    expect(result.summary.headline).toBe("1 overdue");
    expect(result.summary.tone).toBe("warning");
    expect(result.items[0]?.id).toBe("2");
  });
});
