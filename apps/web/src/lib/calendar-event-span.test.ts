import { describe, expect, it } from "vitest";
import { eventOverlapsDate, eventsForDate, spanDayRole } from "./calendar-event-span";
import type { CalendarEventView } from "./calendar-utils";

function ev(partial: Partial<CalendarEventView> & Pick<CalendarEventView, "id" | "startDate">): CalendarEventView {
  return {
    title: "t",
    startTime: null,
    endTime: null,
    allDay: true,
    color: null,
    calendarId: "c",
    ...partial,
  };
}

describe("eventOverlapsDate", () => {
  it("single day", () => {
    const e = ev({ id: "1", startDate: "2026-06-01" });
    expect(eventOverlapsDate(e, "2026-06-01")).toBe(true);
    expect(eventOverlapsDate(e, "2026-06-02")).toBe(false);
  });

  it("multi-day span", () => {
    const e = ev({ id: "1", startDate: "2026-06-01", endDate: "2026-06-03" });
    expect(eventOverlapsDate(e, "2026-06-02")).toBe(true);
    expect(eventsForDate([e], "2026-06-02")).toHaveLength(1);
  });
});

describe("spanDayRole", () => {
  it("marks middle days", () => {
    const e = ev({ id: "1", startDate: "2026-06-01", endDate: "2026-06-03" });
    expect(spanDayRole(e, "2026-06-01")).toBe("start");
    expect(spanDayRole(e, "2026-06-02")).toBe("middle");
    expect(spanDayRole(e, "2026-06-03")).toBe("end");
  });
});
