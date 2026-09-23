import { describe, expect, it } from "vitest";
import { formatChoreDueLabel } from "./glance-meta.js";

describe("formatChoreDueLabel", () => {
  it("names today and tomorrow", () => {
    expect(formatChoreDueLabel("2026-09-23", "2026-09-23")).toBe("Due today");
    expect(formatChoreDueLabel("2026-09-24", "2026-09-23")).toBe("Due tomorrow");
  });

  it("formats past and future dates, adding the year only when it differs", () => {
    expect(formatChoreDueLabel("2026-07-07", "2026-09-23")).toBe("Overdue · Tue, Jul 7");
    expect(formatChoreDueLabel("2026-09-25", "2026-09-23")).toBe("Due Fri, Sep 25");
    expect(formatChoreDueLabel("2027-01-04", "2026-09-23")).toBe("Due Mon, Jan 4, 2027");
  });
});
