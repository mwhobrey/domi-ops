import { describe, expect, it } from "vitest";
import { defaultEventEnd, eventTimeRangeError } from "./event-time.js";
import { eventToGoogleBody } from "./mapper.js";

describe("event time ranges", () => {
  const base = { startDate: "2026-10-20", startTime: "20:00:00", allDay: false };
  it.each(["10:00", "20:00:00"])("rejects same-day end %s before contacting Google", endTime => {
    expect(eventTimeRangeError({ ...base, endTime })).toContain("End time must be after");
    expect(() => eventToGoogleBody({ ...base, endTime, endDate: null, description: null, title: "Demo", timeZone: "America/Chicago" }, "UTC")).toThrow("End time must be after");
  });
  it("accepts an explicit overnight date and same-day positive duration", () => {
    expect(eventTimeRangeError({ ...base, endDate: "2026-10-21", endTime: "10:00" })).toBeNull();
    expect(eventTimeRangeError({ ...base, endTime: "21:00" })).toBeNull();
  });
  it("defaults a missing late-night end to the next date", () => {
    expect(defaultEventEnd("2026-12-31", "23:30:00")).toEqual({ date: "2027-01-01", time: "00:30:00" });
    const body = eventToGoogleBody({ ...base, startDate: "2026-12-31", startTime: "23:30", endDate: null, endTime: null, description: null, title: "Demo", timeZone: "UTC" }, "UTC");
    expect(body.end).toEqual({ dateTime: "2027-01-01T00:30:00", timeZone: "UTC" });
  });
  it("rejects malformed dates, times, and dates before the start", () => {
    expect(eventTimeRangeError({ ...base, startDate: "2026-02-30" })).toContain("valid");
    expect(eventTimeRangeError({ ...base, startTime: "25:00" })).toContain("valid");
    expect(eventTimeRangeError({ ...base, endDate: "2026-10-19" })).toContain("End date");
  });
});
