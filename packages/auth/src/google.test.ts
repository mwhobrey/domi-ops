import { describe, expect, it } from "vitest";
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_DOCS_SCOPES, GOOGLE_LOGIN_SCOPES } from "./google.js";

describe("Google OAuth scopes", () => {
  it("Docs connect uses drive.file only (no documents scope — Family Link)", () => {
    expect(GOOGLE_DOCS_SCOPES).toEqual([
      ...GOOGLE_LOGIN_SCOPES,
      "https://www.googleapis.com/auth/drive.file",
    ]);
    expect(GOOGLE_DOCS_SCOPES.join(" ")).not.toContain("/auth/documents");
  });

  it("Calendar still requests calendar scope", () => {
    expect(GOOGLE_CALENDAR_SCOPES).toContain("https://www.googleapis.com/auth/calendar");
  });
});
