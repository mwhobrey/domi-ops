import { describe, expect, it } from "vitest";
import { normalizeReminderOffsets, offsetsFromGoogleEvent } from "./event-reminders.js";

describe("offsetsFromGoogleEvent", () => {
  it("maps popup overrides to allowed offsets", () => {
    const offsets = offsetsFromGoogleEvent({
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 15 },
          { method: "popup", minutes: 60 },
        ],
      },
    });
    expect(offsets).toEqual([15, 60]);
  });

  it("snaps unknown minutes to nearest preset", () => {
    const offsets = offsetsFromGoogleEvent({
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 20 }],
      },
    });
    expect(normalizeReminderOffsets(offsets)).toEqual([15]);
  });

  it("keeps exact custom minutes when in range", () => {
    expect(normalizeReminderOffsets([45, 90])).toEqual([45, 90]);
  });
});
