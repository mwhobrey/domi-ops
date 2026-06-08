import { describe, expect, it } from "vitest";
import {
  choreMakeRecurringBlockReason,
  resolveRecurringAnchorDate,
} from "./chores.js";

describe("choreMakeRecurringBlockReason", () => {
  it("blocks chores already linked to a template", () => {
    expect(
      choreMakeRecurringBlockReason({ recurringId: "tpl-1", done: false }),
    ).toBe("already_recurring");
  });

  it("blocks completed chores", () => {
    expect(choreMakeRecurringBlockReason({ recurringId: null, done: true })).toBe(
      "already_completed",
    );
  });

  it("allows open one-off chores", () => {
    expect(choreMakeRecurringBlockReason({ recurringId: null, done: false })).toBeNull();
  });
});

describe("resolveRecurringAnchorDate", () => {
  it("uses due date when set", () => {
    expect(resolveRecurringAnchorDate("2026-06-15", "2026-06-08")).toBe("2026-06-15");
  });

  it("falls back to today when due date is missing", () => {
    expect(resolveRecurringAnchorDate(null, "2026-06-08")).toBe("2026-06-08");
    expect(resolveRecurringAnchorDate("", "2026-06-08")).toBe("2026-06-08");
  });
});
