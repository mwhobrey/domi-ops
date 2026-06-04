import { describe, expect, it } from "vitest";
import type { CalendarEventView } from "./calendar-utils";
import {
  buildResizePatch,
  buildResizeStartPatch,
  buildReschedulePatch,
  endMinutesFromChipHeight,
  heightPxFromDuration,
  snapStartOffsetYToMinutes,
  GRID_END_HOUR,
  GRID_START_HOUR,
  layoutTimedEvent,
  MIN_EVENT_DURATION_MIN,
  minutesToTimeString,
  parseTimeToMinutes,
  scrollTopForNow,
  snapEndOffsetYToMinutes,
  snapOffsetYToMinutes,
} from "./calendar-time-grid";

function ev(partial: Partial<CalendarEventView> & Pick<CalendarEventView, "id" | "title">): CalendarEventView {
  return {
    startDate: "2026-06-04",
    startTime: "09:00",
    endTime: "10:00",
    allDay: false,
    color: null,
    calendarId: "c1",
    ...partial,
  };
}

describe("calendar-time-grid", () => {
  it("parses time strings", () => {
    expect(parseTimeToMinutes("09:30")).toBe(570);
    expect(parseTimeToMinutes("22:15:00")).toBe(1335);
    expect(parseTimeToMinutes(null)).toBeNull();
  });

  it("layouts event with start and end", () => {
    const layout = layoutTimedEvent(ev({ id: "1", title: "A", startTime: "09:00", endTime: "10:30" }));
    expect(layout.topPx).toBe(9 * 48);
    expect(layout.heightPx).toBe(1.5 * 48);
  });

  it("defaults duration when end missing", () => {
    const layout = layoutTimedEvent(ev({ id: "2", title: "B", startTime: "14:00", endTime: null }));
    expect(layout.heightPx).toBe(48);
  });

  it("fixes end before start", () => {
    const layout = layoutTimedEvent(ev({ id: "3", title: "C", startTime: "10:00", endTime: "09:00" }));
    expect(layout.heightPx).toBe(48);
  });

  it("covers full day grid hours", () => {
    expect(GRID_START_HOUR).toBe(0);
    expect(GRID_END_HOUR).toBe(24);
  });

  it("scrollTopForNow is non-negative", () => {
    expect(scrollTopForNow()).toBeGreaterThanOrEqual(0);
  });

  it("minutesToTimeString formats HH:mm", () => {
    expect(minutesToTimeString(14 * 60)).toBe("14:00");
  });

  it("snapOffsetYToMinutes snaps to hour rows", () => {
    expect(snapOffsetYToMinutes(10)).toBe(0);
    expect(snapOffsetYToMinutes(48)).toBe(60);
    expect(snapOffsetYToMinutes(100)).toBe(120);
  });

  it("buildReschedulePatch preserves duration", () => {
    const patch = buildReschedulePatch(
      ev({ id: "4", title: "D", startTime: "09:00", endTime: "10:30" }),
      "2026-06-05",
      14 * 60,
    );
    expect(patch.startDate).toBe("2026-06-05");
    expect(patch.startTime).toBe("14:00");
    expect(patch.endTime).toBe("15:30");
  });

  it("buildResizePatch updates end time with minimum duration", () => {
    const patch = buildResizePatch(
      ev({ id: "5", title: "E", startTime: "09:00", endTime: "10:00" }),
      9 * 60 + 15,
    );
    expect(patch.startTime).toBe("09:00");
    expect(patch.endTime).toBe("09:30");
  });

  it("snapEndOffsetYToMinutes enforces min duration from start", () => {
    const start = 9 * 60;
    expect(snapEndOffsetYToMinutes(start, 0)).toBe(start + MIN_EVENT_DURATION_MIN);
  });

  it("endMinutesFromChipHeight derives duration from pixel height", () => {
    const start = 10 * 60;
    const end = endMinutesFromChipHeight(start, 1.5 * 48);
    expect(end - start).toBe(90);
  });

  it("buildResizeStartPatch moves start and keeps end", () => {
    const patch = buildResizeStartPatch(
      ev({ id: "6", title: "F", startTime: "09:00", endTime: "11:00" }),
      10 * 60,
    );
    expect(patch.startTime).toBe("10:00");
    expect(patch.endTime).toBe("11:00");
  });

  it("snapStartOffsetYToMinutes respects minimum duration", () => {
    const end = 12 * 60;
    expect(snapStartOffsetYToMinutes(end, 12 * 48)).toBe(11 * 60 + 30);
  });

  it("heightPxFromDuration maps minutes to pixels", () => {
    expect(heightPxFromDuration(60)).toBe(48);
  });
});
