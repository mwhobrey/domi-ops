import { describe, expect, it } from "vitest";
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_DOCS_SCOPES, GOOGLE_LOGIN_SCOPES, googleAuthUrl } from "./google.js";
import type { Env } from "@domi-ops/config";

describe("Google OAuth scopes", () => {
  it("Docs connect uses drive.file only (no documents scope — Family Link)", () => {
    expect(GOOGLE_DOCS_SCOPES).toEqual([
      "https://www.googleapis.com/auth/drive.file",
    ]);
    expect(GOOGLE_DOCS_SCOPES.join(" ")).not.toContain("/auth/documents");
  });

  it("Calendar requests calendar selection and event operations without calendar administration", () => {
    expect(GOOGLE_CALENDAR_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ]);
  });
  it("keeps login permissions separate from optional connections in the outgoing authorization URL", () => {
    for (const scopes of [GOOGLE_CALENDAR_SCOPES, GOOGLE_DOCS_SCOPES]) {
      const url = new URL(googleAuthUrl({ GOOGLE_OAUTH_CLIENT_ID: "synthetic-client" } as Env, { scopes, redirectUri: "https://app.test/callback", state: "synthetic", accessType: "offline", prompt: "consent" }));
      const requested = url.searchParams.get("scope")!.split(" ");
      for (const login of GOOGLE_LOGIN_SCOPES) expect(requested).not.toContain(login);
      expect(url.searchParams.get("access_type")).toBe("offline");
    }
  });
});
