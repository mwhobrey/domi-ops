import { describe, expect, it } from "vitest";
import { buildGoalsGlance, type GoalGlanceRow } from "./goals-glance.js";

function row(overrides: Partial<GoalGlanceRow> = {}): GoalGlanceRow {
  return {
    id: "g1",
    title: "Goal",
    completed: false,
    claimableCount: 0,
    nextMilestoneTitle: null,
    ...overrides,
  };
}

describe("buildGoalsGlance", () => {
  it("shows an all-clear state with nothing open", () => {
    const result = buildGoalsGlance([], 0, false);
    expect(result.summary.headline).toBe("All caught up");
    expect(result.summary.tone).toBe("success");
    expect(result.items).toEqual([]);
  });

  it("surfaces goals in progress with a default tone", () => {
    const result = buildGoalsGlance(
      [row({ id: "g1", nextMilestoneTitle: "First milestone" })],
      0,
      false,
    );
    expect(result.summary.headline).toBe("1 in progress");
    expect(result.summary.tone).toBe("default");
    expect(result.items[0]).toMatchObject({ id: "g1", meta: "Next: First milestone" });
  });

  it("prioritizes claimable rewards with a warning tone, even for a non-approver", () => {
    const result = buildGoalsGlance(
      [row({ id: "g1", claimableCount: 2 }), row({ id: "g2" })],
      0,
      false,
    );
    expect(result.summary.headline).toBe("2 to claim");
    expect(result.summary.tone).toBe("warning");
    expect(result.items[0].id).toBe("g1");
  });

  it("leads with pending approvals for an approver, ahead of claimable rewards", () => {
    const result = buildGoalsGlance([row({ id: "g1", claimableCount: 1 })], 3, true);
    expect(result.summary.headline).toBe("3 to approve");
    expect(result.summary.tone).toBe("warning");
  });

  it("ignores pending approvals for a non-approver", () => {
    const result = buildGoalsGlance([row({ id: "g1" })], 3, false);
    expect(result.summary.headline).toBe("1 in progress");
  });

  it("caps the overflow count against the first three ordered items", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ id: `g${i}` }));
    const result = buildGoalsGlance(rows, 0, false);
    expect(result.items.length).toBe(4);
    expect(result.overflow).toBe(2);
  });
});
