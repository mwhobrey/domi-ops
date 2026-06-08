import { describe, expect, it } from "vitest";
import { computeChoreCompletion } from "./chores-karma.js";

describe("computeChoreCompletion", () => {
  it("awards base karma with no due date", () => {
    const result = computeChoreCompletion(0, null, new Date("2026-06-08T15:00:00.000Z"));
    expect(result.timing).toBe("no_due");
    expect(result.karmaEarned).toBe(10);
  });

  it("awards on-time bonus", () => {
    const result = computeChoreCompletion(
      2,
      "2026-06-08",
      new Date("2026-06-08T20:00:00.000Z"),
    );
    expect(result.timing).toBe("on_time");
    expect(result.karmaEarned).toBe(10 + 10 + 5);
  });

  it("awards early bonus", () => {
    const result = computeChoreCompletion(
      1,
      "2026-06-10",
      new Date("2026-06-08T12:00:00.000Z"),
    );
    expect(result.timing).toBe("early");
    expect(result.karmaEarned).toBe(10 + 5 + 7);
  });

  it("labels late completion as redemption quest", () => {
    const result = computeChoreCompletion(
      0,
      "2026-06-05",
      new Date("2026-06-08T12:00:00.000Z"),
    );
    expect(result.timing).toBe("redemption");
    expect(result.daysLate).toBe(3);
    expect(result.karmaEarned).toBe(13);
  });
});
