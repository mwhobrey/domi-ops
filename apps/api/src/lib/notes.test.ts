import { describe, expect, it } from "vitest";

import {
  deriveNoteTitleFromContent,
  noteHasTag,
  noteMatchesSearch,
  normalizeNoteTitle,
  parseNoteTagsJson,
  serializeNoteTagsJson,
} from "./notes.js";

describe("note title", () => {
  it("requires explicit titles on normalize", () => {
    expect(normalizeNoteTitle("  Weekly menu  ")).toBe("Weekly menu");
    expect(normalizeNoteTitle("   ")).toBeNull();
    expect(normalizeNoteTitle(undefined)).toBeNull();
  });

  it("derives title from first content line", () => {
    expect(deriveNoteTitleFromContent("# Heading\nBody")).toBe("# Heading");
    expect(deriveNoteTitleFromContent("   \n\nPantry list")).toBe("Pantry list");
    expect(deriveNoteTitleFromContent("   ")).toBe("Untitled");
  });
});

describe("note search", () => {
  it("matches title or content case-insensitively", () => {
    expect(noteMatchesSearch("Grocery list", "milk, eggs", "grocery")).toBe(true);
    expect(noteMatchesSearch("Menu", "chicken soup", "soup")).toBe(true);
    expect(noteMatchesSearch("Menu", "chicken soup", "beef")).toBe(false);
  });
});

describe("note tags", () => {
  it("parses and serializes tag arrays", () => {
    expect(parseNoteTagsJson('["recipes", "meal-plan"]')).toEqual(["recipes", "meal-plan"]);
    expect(serializeNoteTagsJson([" recipes ", "meal-plan", ""])).toBe(
      '["recipes","meal-plan"]',
    );
  });

  it("matches tags case-insensitively", () => {
    expect(noteHasTag('["Recipes"]', "recipes")).toBe(true);
    expect(noteHasTag('["recipes"]', "school")).toBe(false);
    expect(noteHasTag("[]", "recipes")).toBe(false);
  });
});
