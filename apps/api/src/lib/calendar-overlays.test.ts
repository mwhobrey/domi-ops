import { describe, expect, it } from "vitest";
import { mergeCalendarEvents } from "./calendar-overlays.js";
import type { CalendarListEvent } from "./calendar-event-policy.js";

function sample(id: string, date: string, time: string | null = null): CalendarListEvent {
  return {
    id,
    calendarId: "cal-1",
    title: id,
    color: null,
    startDate: date,
    startTime: time,
    endTime: null,
    allDay: !time,
    editable: true,
  };
}

describe("mergeCalendarEvents", () => {
  it("sorts native and overlay events by date and time", () => {
    const native = [sample("a", "2026-06-10", "14:00:00")];
    const overlays = [
      {
        ...sample("overlay:school:1", "2026-06-10", "09:00:00"),
        source: "school" as const,
        overlayKind: "school" as const,
        deepLink: "/school/assignment/1",
        editable: false,
      },
    ];
    const merged = mergeCalendarEvents(native, overlays);
    expect(merged.map((e) => e.id)).toEqual(["overlay:school:1", "a"]);
  });

  it("appends overlays after native when same slot", () => {
    const native = [sample("a", "2026-06-10")];
    const overlays = [
      {
        ...sample("overlay:school:2", "2026-06-10"),
        source: "school" as const,
        overlayKind: "school" as const,
        editable: false,
      },
    ];
    expect(mergeCalendarEvents(native, overlays)).toHaveLength(2);
  });
});
