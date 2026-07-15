import { describe, expect, it } from "vitest";
import { googlePickerAppId } from "./google-picker-app-id.js";

describe("googlePickerAppId", () => {
  it("prefers explicit project number", () => {
    expect(
      googlePickerAppId({
        projectNumber: "166249078987",
        oauthClientId: "999-abc.apps.googleusercontent.com",
      }),
    ).toBe("166249078987");
  });

  it("parses project number from OAuth web client id", () => {
    expect(
      googlePickerAppId({
        oauthClientId: "166249078987-l0vmnautrmud1npee4m25vm1h1qdmbh7.apps.googleusercontent.com",
      }),
    ).toBe("166249078987");
  });

  it("rejects non-numeric project number override", () => {
    expect(
      googlePickerAppId({
        projectNumber: "whobrey-homehub",
        oauthClientId: "166249078987-x.apps.googleusercontent.com",
      }),
    ).toBe("166249078987");
  });

  it("returns null when nothing usable", () => {
    expect(googlePickerAppId({})).toBeNull();
    expect(googlePickerAppId({ oauthClientId: "not-a-client-id" })).toBeNull();
  });
});
