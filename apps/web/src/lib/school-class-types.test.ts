import { describe, expect, it } from "vitest";
import { formatDue, memberLabel } from "./school-class-types";

describe("formatDue", () => {
  it("formats a future date without an overdue marker", () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatDue(future)).not.toContain("overdue");
  });

  it("marks a past date as overdue", () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatDue(past)).toContain("overdue");
  });
});

describe("memberLabel", () => {
  const member = { id: "m1", shownLabel: "Riley", email: "riley@example.com" };

  it("prefers the member's shown label", () => {
    expect(memberLabel(member, "m1")).toBe("Riley");
  });

  it("falls back to a truncated id when the member is missing entirely", () => {
    expect(memberLabel(undefined, "abcdefgh-1234-5678")).toBe("abcdefgh");
  });
});
