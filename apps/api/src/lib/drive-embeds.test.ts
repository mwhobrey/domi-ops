import { describe, expect, it } from "vitest";
import {
  driveEmbedsForContent,
  parseDriveEmbedIds,
  prepareMarkdownSourceForRender,
} from "./drive-embeds.js";

describe("parseDriveEmbedIds", () => {
  it("parses uuid with optional label", () => {
    const content =
      "See [[drive:abc-123|Budget PDF]] and [[drive:def-456]] inline.";
    expect(parseDriveEmbedIds(content)).toEqual(["abc-123", "def-456"]);
  });

  it("dedupes repeated embeds", () => {
    const content = "[[drive:abc-123|A]] again [[drive:abc-123|B]]";
    expect(parseDriveEmbedIds(content)).toEqual(["abc-123"]);
  });

  it("returns empty for plain markdown", () => {
    expect(parseDriveEmbedIds("**bold** [link](https://x.test)")).toEqual([]);
  });

  it("parses shielded Rich-editor embed syntax", () => {
    const shielded = "`[[drive:abc-123|Budget PDF]]`";
    expect(parseDriveEmbedIds(shielded)).toEqual(["abc-123"]);
  });

  it("parses TipTap-escaped plain-text embed syntax", () => {
    const escaped = String.raw`\[\[drive:abc-123\|Budget\]\]`;
    expect(prepareMarkdownSourceForRender(escaped)).toBe("[[drive:abc-123|Budget]]");
    expect(parseDriveEmbedIds(escaped)).toEqual(["abc-123"]);
  });
});

describe("driveEmbedsForContent", () => {
  it("returns only resolved ids present in content", () => {
    const map = new Map([
      [
        "abc-123",
        {
          id: "abc-123",
          title: "Budget",
          kind: "file",
          filename: "budget.pdf",
          url: null,
          contentType: "application/pdf",
        },
      ],
    ]);
    const result = driveEmbedsForContent(
      "[[drive:abc-123|Budget]] and [[drive:missing]]",
      map,
    );
    expect(result).toEqual({
      "abc-123": {
        id: "abc-123",
        title: "Budget",
        kind: "file",
        filename: "budget.pdf",
        url: null,
        contentType: "application/pdf",
      },
    });
  });
});
