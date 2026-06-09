import { describe, expect, it } from "vitest";
import {
  applyDriveEmbedSelection,
  findDriveEmbedTrigger,
} from "./drive-embed-autocomplete";

describe("findDriveEmbedTrigger", () => {
  it("detects open [[ fragment", () => {
    const text = "Hello [[tax";
    const trigger = findDriveEmbedTrigger(text, text.length);
    expect(trigger).toEqual({ start: 6, end: 11, searchQuery: "tax" });
  });

  it("strips drive: prefix for search", () => {
    const text = "[[drive:receipt";
    const trigger = findDriveEmbedTrigger(text, text.length);
    expect(trigger?.searchQuery).toBe("receipt");
  });

  it("returns null when cursor is after a closed embed", () => {
    const text = "See [[drive:abc|Label]] here";
    expect(findDriveEmbedTrigger(text, text.length)).toBeNull();
  });

  it("returns null after space in fragment", () => {
    const text = "[[foo bar";
    expect(findDriveEmbedTrigger(text, text.length)).toBeNull();
  });
});

describe("applyDriveEmbedSelection", () => {
  it("replaces trigger with embed syntax", () => {
    const text = "Note [[tax";
    const trigger = findDriveEmbedTrigger(text, text.length)!;
    const result = applyDriveEmbedSelection(text, trigger, "uuid-1", "Tax doc");
    expect(result.text).toBe("Note [[drive:uuid-1|Tax doc]]");
    expect(result.cursor).toBe(result.text.length);
  });
});
