import { describe, expect, it } from "vitest";
import { filterEventsByOverlays, overlayFilterId, overlayKindsFromEvents } from "./calendar-filters";
import {
  collapseCheckOverlaysForMonth,
  filterGlanceCalendarTileEvents,
  filterPastTimedEvents,
  isHealthSupplyOverlay,
  isOverlayEvent,
  supplyChipKind,
  type CalendarEventView,
} from "./calendar-utils";

const chip = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    title: id.includes("appointment") ? "Fill pill organizer" : "Refill Metformin",
    startDate: "2026-10-21",
    endDate: "2026-10-21",
    startTime: null,
    endTime: null,
    allDay: true,
    calendarId: "__overlay_health_supply__",
    source: "health_supply",
    overlayKind: "health_supply",
    deepLink: "/health",
    attendeeMemberIds: ["m1"],
    ...over,
  }) as unknown as CalendarEventView;

describe("supply chips", () => {
  it("recognises both chips by kind or by id", () => {
    expect(isHealthSupplyOverlay({ id: "x", overlayKind: "health_supply" })).toBe(true);
    expect(isHealthSupplyOverlay({ id: "x", source: "health_supply" })).toBe(true);
    expect(isHealthSupplyOverlay({ id: "overlay:health:appointment:p:2026-10-06" })).toBe(true);
    expect(isHealthSupplyOverlay({ id: "overlay:health:refill:m:2026-10-21" })).toBe(true);
    expect(isHealthSupplyOverlay({ id: "overlay:health:med:m:t", overlayKind: "health_med" })).toBe(false);
    expect(isHealthSupplyOverlay({ id: "overlay:health:check:c:t", source: "health_check" })).toBe(false);
  });

  it("tells a fill from a refill", () => {
    expect(supplyChipKind({ id: "overlay:health:appointment:p:2026-10-06" })).toBe("appointment");
    expect(supplyChipKind({ id: "overlay:health:refill:m:2026-10-21" })).toBe("refill");
    expect(supplyChipKind({ id: "overlay:health:med:m:t" })).toBeNull();
  });

  it("are read-only overlays that open their link", () => {
    expect(isOverlayEvent(chip("overlay:health:refill:m:2026-10-21"))).toBe(true);
  });

  it("stay on the calendar when past, and off the dashboard's calendar tile with the other health tasks", () => {
    const events = [chip("overlay:health:refill:m:2026-10-21"), { ...chip("overlay:school:1"), source: "school", overlayKind: "school" }] as CalendarEventView[];
    expect(filterPastTimedEvents(events, new Date("2027-01-01T00:00:00Z"))).toHaveLength(2);
    expect(filterGlanceCalendarTileEvents(events, new Date("2026-10-21T00:00:00Z")).map((e) => e.id)).toEqual(["overlay:school:1"]);
  });
});

describe("filters", () => {
  it("count fills and refills as medication overlays", () => {
    expect(overlayFilterId("health_supply")).toBe("health_med");
    expect(overlayFilterId("health_check")).toBe("health_check");
    expect(overlayFilterId("school")).toBe("school");
  });

  it("hide them with the Medications switch, and not with the others", () => {
    const events = [chip("overlay:health:refill:m:2026-10-21"), chip("overlay:health:appointment:p:2026-10-21")];
    expect(filterEventsByOverlays(events, new Set(["health_med"]))).toEqual([]);
    expect(filterEventsByOverlays(events, new Set(["health_check", "school", "health_event"]))).toHaveLength(2);
    expect(filterEventsByOverlays(events, new Set())).toHaveLength(2);
  });

  it("show the Medications switch when only these are on the calendar, and add no switch of their own", () => {
    const kinds = overlayKindsFromEvents([chip("overlay:health:refill:m:2026-10-21")] as never);
    expect(kinds.map((k) => k.id)).toEqual(["health_med"]);
    expect(overlayKindsFromEvents([{ overlayKind: "health_supply" }, { overlayKind: "health_med" }]).map((k) => k.id)).toEqual(["health_med"]);
  });
});

describe("month view collapse", () => {
  it("turns a day's refills into one chip with a count, opening the first and naming everyone", () => {
    const events = [
      chip("overlay:health:refill:m2:2026-10-21", { title: "Refill Zinc", deepLink: "/health?supply=m2", attendeeMemberIds: ["m2"] }),
      chip("overlay:health:refill:m1:2026-10-21", { title: "Refill Aspirin", deepLink: "/health?supply=m1", attendeeMemberIds: ["m1"] }),
      chip("overlay:health:refill:m3:2026-10-21", { title: "Refill Lipitor", deepLink: "/health?supply=m3", attendeeMemberIds: ["m1", "m3"] }),
    ];
    const out = collapseCheckOverlaysForMonth(events);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "3 refills due", deepLink: "/health?supply=m1" });
    expect([...out[0]!.attendeeMemberIds!].sort()).toEqual(["m1", "m2", "m3"]);
    expect(supplyChipKind(out[0]!)).toBe("refill");
  });

  it("keeps one refill as it was, one chip per day, and never merges fills", () => {
    const out = collapseCheckOverlaysForMonth([
      chip("overlay:health:refill:m1:2026-10-21"),
      chip("overlay:health:refill:m1:2026-10-22", { startDate: "2026-10-22" }),
      chip("overlay:health:appointment:p:2026-10-21"),
      chip("overlay:health:appointment:p:2026-11-20", { startDate: "2026-11-20" }),
    ]);
    expect(out.map((e) => e.id).sort()).toEqual([
      "overlay:health:appointment:p:2026-10-21",
      "overlay:health:appointment:p:2026-11-20",
      "overlay:health:refill:m1:2026-10-21",
      "overlay:health:refill:m1:2026-10-22",
    ]);
  });

  it("does not mix refills with checks that fall on the same day", () => {
    const check = {
      id: "overlay:health:check:c1:2026-10-21T13:00:00.000Z",
      title: "BP",
      startDate: "2026-10-21",
      startTime: "08:00:00",
      allDay: false,
      source: "health_check",
      overlayKind: "health_check",
    } as unknown as CalendarEventView;
    const out = collapseCheckOverlaysForMonth([check, chip("overlay:health:refill:m1:2026-10-21"), chip("overlay:health:refill:m2:2026-10-21")]);
    expect(out.map((e) => e.title).sort()).toEqual(["2 refills due", "BP"]);
  });
});
