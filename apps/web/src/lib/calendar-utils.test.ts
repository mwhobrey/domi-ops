import { describe, expect, it } from "vitest";
import {
  collapseCheckOverlaysForMonth,
  filterGlanceCalendarTileEvents,
  filterPastTimedEvents,
  formatWallClock,
  isHealthCheckOverlay,
  isHealthMedOverlay,
  type CalendarEventView,
} from "./calendar-utils.js";

describe("formatWallClock", () => {
  it("formats Postgres time strings as 12-hour clock", () => {
    expect(formatWallClock("18:00:00")).toBe("6:00 PM");
    expect(formatWallClock("00:05")).toBe("12:05 AM");
    expect(formatWallClock("12:30:00")).toBe("12:30 PM");
    expect(formatWallClock("09:15:00")).toBe("9:15 AM");
  });

  it("treats Postgres 24:00:00 as end-of-day midnight", () => {
    expect(formatWallClock("24:00:00")).toBe("12:00 AM");
  });

  it("passes unparseable input through", () => {
    expect(formatWallClock("soon")).toBe("soon");
  });
});

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

describe("isHealthCheckOverlay", () => {
  it("detects check and check-group chips, and not medication ones", () => {
    expect(isHealthCheckOverlay({ id: "overlay:health:check:c1:2026-10-05T13:00:00.000Z", source: "health_check" })).toBe(true);
    expect(isHealthCheckOverlay({ id: "overlay:health:checkgroup:g1:x", overlayKind: "health_check" })).toBe(true);
    expect(isHealthCheckOverlay({ id: "overlay:health:med:1", source: "health_med" })).toBe(false);
    expect(isHealthCheckOverlay({ id: "overlay:school:1", source: "school" })).toBe(false);
  });
});

describe("check chips stay visible like dose chips", () => {
  const now = new Date(2026, 9, 5, 15, 0, 0);
  const chip = (id: string, startTime: string) => ({
    id,
    allDay: false,
    startDate: "2026-10-05",
    startTime,
    endTime: null,
    source: "health_check",
    overlayKind: "health_check",
  });

  it("keeps a past, still-waiting check (it is overdue, not finished)", () => {
    const events = [chip("overlay:health:check:c1:2026-10-05T13:00:00.000Z", "08:00:00")];
    expect(filterPastTimedEvents(events, now)).toHaveLength(1);
  });

  it("leaves checks off the dashboard calendar tile, which the health tile owns", () => {
    const events = [chip("overlay:health:check:c1:2026-10-05T13:00:00.000Z", "18:00:00")];
    expect(filterGlanceCalendarTileEvents(events, now)).toEqual([]);
  });
});

describe("collapseCheckOverlaysForMonth", () => {
  const ev = (id: string, startDate: string, startTime: string, over: Record<string, unknown> = {}) =>
    ({
      id,
      title: "BP",
      startDate,
      endDate: null,
      startTime,
      endTime: null,
      allDay: false,
      calendarId: "__overlay_health_check__",
      source: "health_check",
      overlayKind: "health_check",
      deepLink: `/health?check=c1&scheduledAt=${encodeURIComponent(id.split(":").slice(4).join(":"))}`,
      ...over,
    }) as unknown as CalendarEventView;

  it("turns a day's slots of one check into one chip with a count, opening the earliest", () => {
    const events = [
      ev("overlay:health:check:c1:2026-10-05T18:00:00.000Z", "2026-10-05", "13:00:00"),
      ev("overlay:health:check:c1:2026-10-05T13:00:00.000Z", "2026-10-05", "08:00:00"),
      ev("overlay:health:check:c1:2026-10-05T22:00:00.000Z", "2026-10-05", "17:00:00"),
    ];
    const out = collapseCheckOverlaysForMonth(events);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "BP ×3", startTime: "08:00:00" });
    expect(out[0]!.deepLink).toContain(encodeURIComponent("2026-10-05T13:00:00.000Z"));
  });

  it("keeps one chip per day, and leaves a single slot as it was", () => {
    const events = [
      ev("overlay:health:check:c1:2026-10-05T13:00:00.000Z", "2026-10-05", "08:00:00"),
      ev("overlay:health:check:c1:2026-10-06T13:00:00.000Z", "2026-10-06", "08:00:00"),
    ];
    const out = collapseCheckOverlaysForMonth(events);
    expect(out.map((e) => e.title)).toEqual(["BP", "BP"]);
    expect(out.map((e) => e.id).sort()).toEqual(events.map((e) => e.id).sort());
  });

  it("collapses each check and each group separately", () => {
    const events = [
      ev("overlay:health:check:c1:2026-10-05T13:00:00.000Z", "2026-10-05", "08:00:00"),
      ev("overlay:health:check:c1:2026-10-05T18:00:00.000Z", "2026-10-05", "13:00:00"),
      ev("overlay:health:check:c2:2026-10-05T13:00:00.000Z", "2026-10-05", "08:00:00", { title: "Weight" }),
      ev("overlay:health:checkgroup:g1:2026-10-05T13:00:00.000Z", "2026-10-05", "08:00:00", { title: "Morning" }),
      ev("overlay:health:checkgroup:g1:2026-10-05T18:00:00.000Z", "2026-10-05", "13:00:00", { title: "Morning" }),
    ];
    expect(collapseCheckOverlaysForMonth(events).map((e) => e.title).sort()).toEqual(["BP ×2", "Morning ×2", "Weight"]);
  });

  it("never touches other events, including medication chips", () => {
    const med = ev("overlay:health:med:m1:2026-10-05T13:00:00.000Z", "2026-10-05", "08:00:00", {
      source: "health_med",
      overlayKind: "health_med",
      title: "Vitamin",
    });
    const plain = ev("local-1", "2026-10-05", "09:00:00", { source: "local", overlayKind: undefined, title: "Dentist" });
    const out = collapseCheckOverlaysForMonth([med, plain, med]);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.title)).toEqual(["Vitamin", "Dentist", "Vitamin"]);
  });
});
