import { describe, expect, it } from "vitest";
import { noteVisibilityLabel } from "./note-visibility";

describe("noteVisibilityLabel", () => {
  it("labels private and household notes", () => {
    expect(noteVisibilityLabel("private")).toBe("Private note");
    expect(noteVisibilityLabel("household")).toBe("Household note");
  });

  it("labels shared private notes", () => {
    expect(noteVisibilityLabel("private", { sharedCount: 1 })).toBe(
      "Private · shared with 1 member",
    );
    expect(noteVisibilityLabel("private", { sharedCount: 3 })).toBe(
      "Private · shared with 3 members",
    );
    expect(noteVisibilityLabel("private", { sharedWithMe: true })).toBe("Shared with you");
  });
});
