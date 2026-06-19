import { describe, expect, it } from "vitest";
import { reminderOffsetsFromHomeHubRow } from "./calendar-reminder-import.js";

describe("reminderOffsetsFromHomeHubRow", () => {
  it("maps first present offset column", () => {
    const cols = new Set(["notify_minutes", "reminder_minutes"]);
    expect(reminderOffsetsFromHomeHubRow({ notify_minutes: 30 }, cols)).toEqual([30]);
    expect(reminderOffsetsFromHomeHubRow({ reminder_minutes: 15 }, new Set(["reminder_minutes"]))).toEqual(
      [15],
    );
  });

  it("no-ops when column missing or invalid", () => {
    expect(reminderOffsetsFromHomeHubRow({}, new Set())).toEqual([]);
    expect(reminderOffsetsFromHomeHubRow({ notify_minutes: 0 }, new Set(["notify_minutes"]))).toEqual([]);
    expect(reminderOffsetsFromHomeHubRow({ notify_minutes: 20000 }, new Set(["notify_minutes"]))).toEqual(
      [],
    );
  });
});
