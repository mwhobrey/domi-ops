import { describe, expect, it } from "vitest";
import { GOOGLE_FORMS_MIME, googleFileOpenUrl, isGoogleFormsMime } from "./google-picker";

describe("google-picker helpers", () => {
  it("detects Google Forms mime", () => {
    expect(isGoogleFormsMime(GOOGLE_FORMS_MIME)).toBe(true);
    expect(isGoogleFormsMime("application/vnd.google-apps.document")).toBe(false);
  });

  it("builds open URLs by mime", () => {
    expect(googleFileOpenUrl("file-1", "application/vnd.google-apps.document")).toContain(
      "document/d/file-1",
    );
  });
});
