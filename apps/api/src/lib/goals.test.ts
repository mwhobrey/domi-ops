import { describe, expect, it } from "vitest";
import { GoalValidationError, milestonesCrossedByTotal, validateMilestoneShapes } from "./goals.js";

describe("validateMilestoneShapes", () => {
  it("accepts strictly ascending thresholds with non-empty titles", () => {
    const result = validateMilestoneShapes([
      { threshold: 5, title: "First" },
      { threshold: 10, title: "Second" },
    ]);
    expect(result).toEqual([
      { threshold: 5, title: "First", rewardId: null },
      { threshold: 10, title: "Second", rewardId: null },
    ]);
  });

  it("rejects an empty list", () => {
    expect(() => validateMilestoneShapes([])).toThrow(GoalValidationError);
  });

  it("rejects an empty title", () => {
    expect(() => validateMilestoneShapes([{ threshold: 5, title: "  " }])).toThrow(
      /title/,
    );
  });

  it("rejects a non-ascending threshold", () => {
    expect(() =>
      validateMilestoneShapes([
        { threshold: 10, title: "First" },
        { threshold: 5, title: "Second" },
      ]),
    ).toThrow(/strictly increase/);
  });

  it("rejects a duplicate threshold", () => {
    expect(() =>
      validateMilestoneShapes([
        { threshold: 10, title: "First" },
        { threshold: 10, title: "Second" },
      ]),
    ).toThrow(/strictly increase/);
  });

  it("enforces the minThreshold floor (already-achieved milestones stay ahead of new ones)", () => {
    expect(() =>
      validateMilestoneShapes([{ threshold: 5, title: "Too low" }], 10),
    ).toThrow(/strictly increase/);
    expect(validateMilestoneShapes([{ threshold: 15, title: "OK" }], 10)).toEqual([
      { threshold: 15, title: "OK", rewardId: null },
    ]);
  });

  it("rejects more than the max milestone count", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ threshold: i + 1, title: `M${i}` }));
    expect(() => validateMilestoneShapes(many)).toThrow(/most/);
  });

  it("normalizes a blank rewardId to null", () => {
    expect(validateMilestoneShapes([{ threshold: 5, title: "First", rewardId: "" }])).toEqual([
      { threshold: 5, title: "First", rewardId: null },
    ]);
  });
});

describe("milestonesCrossedByTotal", () => {
  const milestones = [
    { id: "a", threshold: 5, achievedAt: null },
    { id: "b", threshold: 10, achievedAt: null },
    { id: "c", threshold: 20, achievedAt: null },
  ];

  it("returns nothing when the total hasn't reached the first threshold", () => {
    expect(milestonesCrossedByTotal(milestones, 3)).toEqual([]);
  });

  it("returns exactly the milestone crossed", () => {
    expect(milestonesCrossedByTotal(milestones, 7)).toEqual(["a"]);
  });

  it("returns every milestone crossed by a single large jump", () => {
    expect(milestonesCrossedByTotal(milestones, 25)).toEqual(["a", "b", "c"]);
  });

  it("never returns an already-achieved milestone, even if the total later drops below its threshold (ratchet)", () => {
    const partlyAchieved = [
      { id: "a", threshold: 5, achievedAt: new Date("2026-01-01") },
      { id: "b", threshold: 10, achievedAt: null },
    ];
    expect(milestonesCrossedByTotal(partlyAchieved, 2)).toEqual([]);
    expect(milestonesCrossedByTotal(partlyAchieved, 12)).toEqual(["b"]);
  });

  it("treats hitting a threshold exactly as crossing it", () => {
    expect(milestonesCrossedByTotal(milestones, 10)).toEqual(["a", "b"]);
  });
});
