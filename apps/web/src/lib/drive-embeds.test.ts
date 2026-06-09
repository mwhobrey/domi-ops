import { describe, expect, it } from "vitest";
import {
  contentHasDriveEmbeds,
  DRIVE_EMBED_LINK_PREFIX,
  isDriveEmbedImage,
  prepareMarkdownSourceForRender,
  preprocessDriveEmbedsForMarkdown,
  shieldDriveEmbedsForRichEditor,
  unshieldDriveEmbedsFromRichEditor,
} from "./drive-embeds";
import type { DriveEmbedObject } from "./drive-types";

describe("contentHasDriveEmbeds", () => {
  it("detects drive embed syntax", () => {
    expect(contentHasDriveEmbeds("[[drive:abc-123|Budget]]")).toBe(true);
    expect(contentHasDriveEmbeds("**bold** only")).toBe(false);
  });
});

describe("isDriveEmbedImage", () => {
  it("detects image content types and extensions", () => {
    const gif: DriveEmbedObject = {
      id: "1",
      title: "anim",
      kind: "file",
      filename: "anim.gif",
      url: null,
      contentType: "image/gif",
    };
    const pdf: DriveEmbedObject = {
      id: "2",
      title: "doc",
      kind: "file",
      filename: "doc.pdf",
      url: null,
      contentType: "application/pdf",
    };
    expect(isDriveEmbedImage(gif)).toBe(true);
    expect(isDriveEmbedImage(pdf)).toBe(false);
    expect(isDriveEmbedImage({ ...pdf, contentType: null, filename: "photo.webp" })).toBe(true);
  });
});

describe("preprocessDriveEmbedsForMarkdown", () => {
  it("emits image markdown for image files", () => {
    const resolutions: Record<string, DriveEmbedObject> = {
      "abc-123": {
        id: "abc-123",
        title: "Logo",
        kind: "file",
        filename: "logo.png",
        url: null,
        contentType: "image/png",
      },
    };
    const result = preprocessDriveEmbedsForMarkdown("See [[drive:abc-123|Logo]] here.", resolutions);
    expect(result).toBe(`See ![Logo](${DRIVE_EMBED_LINK_PREFIX}abc-123) here.`);
  });

  it("emits link markdown for non-image files", () => {
    const resolutions: Record<string, DriveEmbedObject> = {
      "abc-123": {
        id: "abc-123",
        title: "Budget",
        kind: "file",
        filename: "budget.pdf",
        url: null,
        contentType: "application/pdf",
      },
    };
    const result = preprocessDriveEmbedsForMarkdown("[[drive:abc-123|Budget]]", resolutions);
    expect(result).toBe(`[Budget](${DRIVE_EMBED_LINK_PREFIX}abc-123)`);
  });

  it("preprocesses missing objects without resolutions map entry", () => {
    const result = preprocessDriveEmbedsForMarkdown("[[drive:missing-id|Gone]]", {});
    expect(result).toContain("whome-drive-missing://missing-id");
  });

  it("treats gif label as image before resolve completes", () => {
    const result = preprocessDriveEmbedsForMarkdown(
      "[[drive:pending-id|insain-early-alpha.gif]]",
      {},
    );
    expect(result).toBe(`![insain-early-alpha.gif](${DRIVE_EMBED_LINK_PREFIX}pending-id)`);
  });

  it("preprocesses real-world uuid gif embeds", () => {
    const content = "[[drive:41dbbba0-f4e1-4387-a5ee-724f05d67407|insain-early-alpha.gif]]";
    const result = preprocessDriveEmbedsForMarkdown(content, {
      "41dbbba0-f4e1-4387-a5ee-724f05d67407": {
        id: "41dbbba0-f4e1-4387-a5ee-724f05d67407",
        title: "insain-early-alpha.gif",
        kind: "file",
        filename: "insain-early-alpha.gif",
        url: null,
        contentType: "image/gif",
      },
    });
    expect(result).toBe(
      `![insain-early-alpha.gif](${DRIVE_EMBED_LINK_PREFIX}41dbbba0-f4e1-4387-a5ee-724f05d67407)`,
    );
  });
});

describe("prepareMarkdownSourceForRender", () => {
  it("unwraps Rich-editor inline-code shields for preview", () => {
    const shielded = "Intro `[[drive:abc-123|Logo.png]]` tail";
    expect(prepareMarkdownSourceForRender(shielded)).toBe(
      "Intro [[drive:abc-123|Logo.png]] tail",
    );
  });

  it("unwraps TipTap-escaped embed tokens inside inline code", () => {
    const escaped = String.raw`\[\[drive:abc-123\|Logo.png\]\]`;
    expect(prepareMarkdownSourceForRender(`Before \`${escaped}\` after`)).toBe(
      "Before [[drive:abc-123|Logo.png]] after",
    );
  });

  it("unwraps TipTap-escaped embed tokens in plain text", () => {
    const escaped = String.raw`\[\[drive:abc-123\|Logo.png\]\]`;
    expect(prepareMarkdownSourceForRender(escaped)).toBe("[[drive:abc-123|Logo.png]]");
    expect(contentHasDriveEmbeds(escaped)).toBe(true);
  });

  it("preprocesses shielded embeds into image markdown", () => {
    const shielded = "`[[drive:abc-123|Logo]]`";
    const result = preprocessDriveEmbedsForMarkdown(shielded, {
      "abc-123": {
        id: "abc-123",
        title: "Logo",
        kind: "file",
        filename: "logo.png",
        url: null,
        contentType: "image/png",
      },
    });
    expect(result).toBe(`![Logo](${DRIVE_EMBED_LINK_PREFIX}abc-123)`);
  });
});

describe("shieldDriveEmbedsForRichEditor", () => {
  it("wraps embed syntax in inline code for TipTap", () => {
    const raw = "Intro [[drive:abc-123|Logo.png]] tail";
    expect(shieldDriveEmbedsForRichEditor(raw)).toBe(
      "Intro `[[drive:abc-123|Logo.png]]` tail",
    );
  });

  it("round-trips through unshield", () => {
    const raw = "[[drive:41dbbba0-f4e1-4387-a5ee-724f05d67407|insain-early-alpha.gif]]";
    const shielded = shieldDriveEmbedsForRichEditor(raw);
    expect(unshieldDriveEmbedsFromRichEditor(shielded)).toBe(raw);
  });
});
