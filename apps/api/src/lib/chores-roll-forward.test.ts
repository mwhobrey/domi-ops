import { describe, expect, it } from "vitest";
import { rollForwardDueDate } from "./chores.js";

describe("rollForwardDueDate", () => {
  it("moves a missed daily chore to today and counts each skipped day", () => {
    expect(rollForwardDueDate("daily", "2026-07-07", "2026-09-23")).toEqual({
      dueDate: "2026-09-23",
      missed: 78,
    });
  });

  it("leaves a weekly chore overdue until its next occurrence arrives", () => {
    expect(rollForwardDueDate("weekly", "2026-09-21", "2026-09-24")).toEqual({
      dueDate: "2026-09-21",
      missed: 0,
    });
    expect(rollForwardDueDate("weekly", "2026-09-21", "2026-09-28")).toEqual({
      dueDate: "2026-09-28",
      missed: 1,
    });
  });

  it("keeps month-end dates clamped", () => {
    expect(rollForwardDueDate("monthly", "2026-01-31", "2026-03-05")).toEqual({
      dueDate: "2026-02-28",
      missed: 1,
    });
  });

  it("does nothing when the due date is today or later", () => {
    expect(rollForwardDueDate("daily", "2026-09-23", "2026-09-23")).toEqual({
      dueDate: "2026-09-23",
      missed: 0,
    });
  });
});
