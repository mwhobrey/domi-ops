import { describe, expect, it } from "vitest";
import {
  driveEmbedInsertLabel,
  driveEmbedMarkdownFromPayload,
  encodeDriveEmbedDragPayload,
  parseDriveEmbedDragPayload,
} from "./drive-embed-drag";

describe("driveEmbedInsertLabel", () => {
  it("prefers filename for image embed labels", () => {
    expect(driveEmbedInsertLabel({ title: "Anim", filename: "anim.gif" })).toBe("anim.gif");
  });
});

describe("parseDriveEmbedDragPayload", () => {
  it("reads structured drag payload", () => {
    const dt = {
      getData: (type: string) =>
        type === "application/x-domi-ops-drive-embed"
          ? encodeDriveEmbedDragPayload({ id: "uuid-1", label: "photo.png" })
          : "",
      types: ["application/x-domi-ops-drive-embed"],
    } as unknown as DataTransfer;

    expect(parseDriveEmbedDragPayload(dt)).toEqual({ id: "uuid-1", label: "photo.png" });
  });

  it("falls back to plain embed markdown", () => {
    const dt = {
      getData: (type: string) =>
        type === "text/plain" ? "[[drive:uuid-2|budget.pdf]]" : "",
      types: ["text/plain"],
    } as unknown as DataTransfer;

    expect(parseDriveEmbedDragPayload(dt)).toEqual({ id: "uuid-2", label: "budget.pdf" });
  });
});

describe("driveEmbedMarkdownFromPayload", () => {
  it("formats embed syntax", () => {
    expect(driveEmbedMarkdownFromPayload({ id: "a", label: "x.gif" })).toBe(
      "[[drive:a|x.gif]]",
    );
  });
});
