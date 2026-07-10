import { describe, expect, it } from "vitest";
import { googleFileWebUrl, GOOGLE_FORMS_MIME } from "./google-drive-export.js";

describe("google-drive-export helpers", () => {
  it("builds doc, sheet, and slide URLs", () => {
    expect(googleFileWebUrl("abc", "application/vnd.google-apps.document")).toContain(
      "/document/d/abc/",
    );
    expect(googleFileWebUrl("abc", "application/vnd.google-apps.spreadsheet")).toContain(
      "/spreadsheets/d/abc/",
    );
    expect(googleFileWebUrl("abc", "application/vnd.google-apps.presentation")).toContain(
      "/presentation/d/abc/",
    );
    expect(googleFileWebUrl("abc", "application/pdf")).toContain("/file/d/abc/");
  });

  it("defines forms mime constant", () => {
    expect(GOOGLE_FORMS_MIME).toBe("application/vnd.google-apps.form");
  });
});
