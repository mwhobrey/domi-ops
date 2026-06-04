import { describe, expect, it } from "vitest";
import { eventToGoogleBody } from "./mapper.js";

describe("eventToGoogleBody", () => {
  it("builds timed event with dateTime", () => {
    const body = eventToGoogleBody(
      {
        title: "Meet",
        description: null,
        startDate: "2026-06-04",
        endDate: "2026-06-04",
        startTime: "09:00",
        endTime: "10:30",
        allDay: false,
        timeZone: "America/Chicago",
      },
      "America/Chicago",
    );
    expect(body.summary).toBe("Meet");
    expect((body.start as { dateTime: string }).dateTime).toContain("2026-06-04T09:00");
    expect((body.end as { dateTime: string }).dateTime).toContain("10:30");
  });

  it("builds all-day event with date fields", () => {
    const body = eventToGoogleBody(
      {
        title: "Holiday",
        description: null,
        startDate: "2026-07-04",
        endDate: null,
        startTime: null,
        endTime: null,
        allDay: true,
        timeZone: null,
      },
      "UTC",
    );
    expect((body.start as { date: string }).date).toBe("2026-07-04");
    expect((body.end as { date: string }).date).toBeDefined();
  });
});
