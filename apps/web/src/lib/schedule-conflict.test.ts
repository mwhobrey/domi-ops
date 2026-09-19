import { describe, expect, it } from "vitest";
import {
  buildConflictCheckParams,
  createDraftFromCheckedWindow,
  eventFormToConflictFormState,
  parseCalendarCreateDraftFromSearchParams,
  calendarCreateDraftToSearchParams,
} from "./schedule-conflict";

describe("eventFormToConflictFormState", () => {
  it("uses range mode when end time differs from start", () => {
    const form = eventFormToConflictFormState({
      startDate: "2026-09-18",
      endDate: "",
      startTime: "09:00",
      endTime: "10:30",
      allDay: false,
      driveBufferBefore: "15",
      driveBufferAfter: "",
    });
    expect(form.mode).toBe("range");
    expect(form.rangeEndTime).toBe("10:30");
    expect(form.bufferOpen).toBe(true);
    expect(buildConflictCheckParams(form).get("bufferBeforeMinutes")).toBe("15");
  });

  it("uses at mode for a single start instant", () => {
    const form = eventFormToConflictFormState({
      startDate: "2026-09-18",
      endDate: "",
      startTime: "09:00",
      endTime: "09:00",
      allDay: false,
      driveBufferBefore: "",
      driveBufferAfter: "",
    });
    expect(form.mode).toBe("at");
    expect(buildConflictCheckParams(form).get("date")).toBe("2026-09-18");
  });
});

describe("createDraftFromCheckedWindow", () => {
  it("defaults a one-hour slot for point-in-time checks", () => {
    const draft = createDraftFromCheckedWindow({
      mode: "at",
      timeZone: "America/Chicago",
      startAt: "2026-09-18T14:00:00.000Z",
      endAt: "2026-09-18T14:00:00.000Z",
      adHocBuffer: { beforeMinutes: 10, afterMinutes: 5 },
    });
    expect(draft.startDate).toBe("2026-09-18");
    expect(draft.startTime).toMatch(/^\d{2}:\d{2}$/);
    expect(draft.endTime).not.toBe(draft.startTime);
    expect(draft.driveBufferBeforeMinutes).toBe(10);
    expect(draft.driveBufferAfterMinutes).toBe(5);
  });
});

describe("calendar create query round-trip", () => {
  it("serializes and parses new-event deep links", () => {
    const draft = {
      startDate: "2026-09-18",
      startTime: "09:00",
      endTime: "10:00",
      allDay: false,
      driveBufferBeforeMinutes: 20,
      driveBufferAfterMinutes: null,
    };
    const qs = calendarCreateDraftToSearchParams(draft);
    const parsed = parseCalendarCreateDraftFromSearchParams(qs);
    expect(parsed).toMatchObject({
      startDate: "2026-09-18",
      startTime: "09:00",
      endTime: "10:00",
      driveBufferBeforeMinutes: 20,
    });
  });
});
