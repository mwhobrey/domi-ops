import { describe, expect, it } from "vitest";
import {
  filterGlanceCalendarTileEvents,
  filterPastTimedEvents,
  isHealthMedOverlay,
} from "./calendar-utils.js";

describe("isHealthMedOverlay", () => {
  it("detects med and med-group overlays", () => {
    expect(isHealthMedOverlay({ id: "overlay:health:med:1", source: "health_med" })).toBe(true);
    expect(isHealthMedOverlay({ id: "overlay:health:medgroup:1", overlayKind: "health_med" })).toBe(
      true,
    );
    expect(isHealthMedOverlay({ id: "overlay:school:1", source: "school" })).toBe(false);
  });
});

describe("filterPastTimedEvents", () => {
  it("keeps all-day and future timed events; drops past timed", () => {
    const now = new Date(2026, 8, 14, 15, 0, 0); // Sep 14 2026 3pm local
    const events = [
      { id: "a", allDay: true, startDate: "2026-09-14", startTime: null, endTime: null },
      {
        id: "b",
        allDay: false,
        startDate: "2026-09-14",
        startTime: "09:00:00",
        endTime: "10:00:00",
      },
      {
        id: "c",
        allDay: false,
        startDate: "2026-09-14",
        startTime: "16:00:00",
        endTime: null,
      },
      {
        id: "d",
        allDay: false,
        startDate: "2026-09-14",
        startTime: "14:00:00",
        endTime: "16:00:00",
      },
      {
        id: "overlay:health:med:overdue",
        allDay: false,
        startDate: "2026-09-14",
        startTime: "08:00:00",
        endTime: null,
        source: "health_med",
      },
    ];
    expect(filterPastTimedEvents(events, now).map((e) => e.id)).toEqual([
      "a",
      "c",
      "d",
      "overlay:health:med:overdue",
    ]);
  });
});

describe("filterGlanceCalendarTileEvents", () => {
  it("drops med overlays and past timed events", () => {
    const now = new Date(2026, 8, 14, 15, 0, 0);
    const events = [
      {
        id: "overlay:health:med:x",
        allDay: false,
        startDate: "2026-09-14",
        startTime: "16:00:00",
        endTime: null,
        source: "health_med",
      },
      {
        id: "meeting",
        allDay: false,
        startDate: "2026-09-14",
        startTime: "16:00:00",
        endTime: null,
        source: "local",
      },
      {
        id: "past",
        allDay: false,
        startDate: "2026-09-14",
        startTime: "08:00:00",
        endTime: null,
        source: "google",
      },
    ];
    expect(filterGlanceCalendarTileEvents(events, now).map((e) => e.id)).toEqual(["meeting"]);
  });
});
