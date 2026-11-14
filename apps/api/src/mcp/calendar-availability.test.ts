import { describe, expect, it } from "vitest";
import { MCP_CAPABILITIES } from "@domi-ops/config";
import { AVAILABILITY_LIMITS, availabilityInput, availabilityOutput, busyIntervals, calendarTools, pendingOccurrences, type BusySource, type RuleSource } from "./calendar-availability.js";

const zone = "America/Chicago";
const timed = (startDate: string, startTime: string, endTime: string | null, extra: Partial<BusySource> = {}): BusySource =>
  ({ startDate, endDate: null, startTime, endTime, allDay: false, timeZone: null, ...extra });
const allDay = (startDate: string, endDate: string | null = null): BusySource => ({ startDate, endDate, startTime: null, endTime: null, allDay: true, timeZone: null });
const busy = (events: BusySource[], from = "2026-07-01", to = "2026-07-01") => busyIntervals(events, from, to, zone).intervals;

describe("busy intervals", () => {
  it("merges overlapping and back-to-back events so their number cannot be read", () => {
    const three = busy([timed("2026-07-01", "13:00", "14:00"), timed("2026-07-01", "14:00:00", "15:00:00"), timed("2026-07-01", "14:30", "15:30")]);
    const one = busy([timed("2026-07-01", "13:00", "15:30")]);
    expect(three).toEqual([{ start: "2026-07-01T13:00", end: "2026-07-01T15:30", allDay: false }]);
    expect(three).toEqual(one);
    // A gap of one minute stays a gap.
    expect(busy([timed("2026-07-01", "09:00", "10:00"), timed("2026-07-01", "10:01", "11:00")])).toHaveLength(2);
  });

  it("folds drive buffers into the block", () => {
    expect(busy([timed("2026-07-01", "16:00", "17:00", { bufferBeforeMinutes: 30, bufferAfterMinutes: 15 })])).toEqual([{ start: "2026-07-01T15:30", end: "2026-07-01T17:15", allDay: false }]);
    // Nonsense buffers are bounded, never trusted.
    expect(busy([timed("2026-07-01", "12:00", "13:00", { bufferBeforeMinutes: -50, bufferAfterMinutes: Number.NaN })])).toEqual([{ start: "2026-07-01T12:00", end: "2026-07-01T13:00", allDay: false }]);
    expect(busy([timed("2026-07-01", "12:00", "13:00", { bufferBeforeMinutes: 100000 })])[0].start).toBe("2026-07-01T00:00");
  });

  it("keeps all-day entries apart from timed ones and merges consecutive days", () => {
    expect(busy([allDay("2026-07-01"), allDay("2026-07-02", "2026-07-03"), timed("2026-07-01", "09:00", "10:00")], "2026-07-01", "2026-07-04")).toEqual([
      { start: "2026-07-01T00:00", end: "2026-07-04T00:00", allDay: true },
      { start: "2026-07-01T09:00", end: "2026-07-01T10:00", allDay: false },
    ]);
    // An event with no start time is treated as a whole day.
    expect(busy([{ startDate: "2026-07-01", endDate: null, startTime: null, endTime: null, allDay: false, timeZone: null }])).toEqual([{ start: "2026-07-01T00:00", end: "2026-07-02T00:00", allDay: true }]);
  });

  it("clips to the requested dates and drops anything outside them", () => {
    expect(busy([timed("2026-06-30", "23:00", "01:00"), timed("2026-07-01", "23:30", "00:30"), timed("2026-07-03", "09:00", "10:00"), allDay("2026-06-29", "2026-06-30")])).toEqual([
      { start: "2026-07-01T00:00", end: "2026-07-01T01:00", allDay: false },
      { start: "2026-07-01T23:30", end: "2026-07-02T00:00", allDay: false },
    ]);
    expect(busy([])).toEqual([]);
  });

  it("reads an event in its own timezone and reports it in the household's", () => {
    expect(busy([timed("2026-07-01", "09:00", "10:00", { timeZone: "America/New_York" })])).toEqual([{ start: "2026-07-01T08:00", end: "2026-07-01T09:00", allDay: false }]);
    // An unknown zone falls back to the household's instead of failing the whole read.
    expect(busy([timed("2026-07-01", "09:00", "10:00", { timeZone: "Not/A_Zone" })])).toEqual([{ start: "2026-07-01T09:00", end: "2026-07-01T10:00", allDay: false }]);
  });

  it("gives an event with no end one hour and follows an explicit end date", () => {
    expect(busy([timed("2026-07-01", "09:00", null)])).toEqual([{ start: "2026-07-01T09:00", end: "2026-07-01T10:00", allDay: false }]);
    expect(busy([timed("2026-07-01", "09:00", "11:00", { endDate: "2026-07-02" })], "2026-07-01", "2026-07-02")).toEqual([{ start: "2026-07-01T09:00", end: "2026-07-02T11:00", allDay: false }]);
  });

  it("caps the list and says it was cut", () => {
    const many = Array.from({ length: 10 }, (_, hour) => timed("2026-07-01", `${String(hour + 8).padStart(2, "0")}:00`, `${String(hour + 8).padStart(2, "0")}:30`));
    const cut = busyIntervals(many, "2026-07-01", "2026-07-01", zone, 4);
    expect(cut.intervals).toHaveLength(4);
    expect(cut.truncated).toBe(true);
    expect(cut.intervals[0].start).toBe("2026-07-01T08:00");
    expect(busyIntervals(many, "2026-07-01", "2026-07-01", zone).truncated).toBe(false);
  });

  it("keeps a day that changes clocks to its local midnights", () => {
    // 2026-03-08 is 23 hours long in Chicago.
    expect(busyIntervals([allDay("2026-03-08")], "2026-03-08", "2026-03-08", zone).intervals).toEqual([{ start: "2026-03-08T00:00", end: "2026-03-09T00:00", allDay: true }]);
  });
});

describe("repeating events not stored yet", () => {
  const rule: RuleSource = { id: "rule-1", rrule: "FREQ=WEEKLY", startDate: "2026-07-01", endDate: null, durationDays: 0, startTime: "07:00:00", endTime: "07:30:00", allDay: false, timeZone: null, lastGeneratedDate: null };
  const dates = (value: RuleSource, stored: string[] = []) => pendingOccurrences(value, "2026-07-01", "2026-07-15", new Set(stored)).map((entry) => entry.startDate);

  it("expands a rule across the window without writing anything", () => {
    expect(dates(rule)).toEqual(["2026-07-01", "2026-07-08", "2026-07-15"]);
    expect(pendingOccurrences(rule, "2026-07-01", "2026-07-15", new Set())[0]).toEqual({ startDate: "2026-07-01", endDate: null, startTime: "07:00:00", endTime: "07:30:00", allDay: false, timeZone: null });
  });

  it("leaves out an occurrence that is already stored as an event", () => {
    expect(dates(rule, ["rule-1|2026-07-08", "other-rule|2026-07-15"])).toEqual(["2026-07-01", "2026-07-15"]);
  });

  it("does not bring back an occurrence at or before the generated mark", () => {
    // Stored occurrences come from the events table; a missing one here was removed by the member.
    expect(dates({ ...rule, lastGeneratedDate: "2026-07-08" })).toEqual(["2026-07-15"]);
    expect(dates({ ...rule, lastGeneratedDate: "2026-07-15" })).toEqual([]);
  });

  it("respects the series end, a count and a multi-day span", () => {
    expect(dates({ ...rule, endDate: "2026-07-08" })).toEqual(["2026-07-01", "2026-07-08"]);
    expect(dates({ ...rule, rrule: "FREQ=WEEKLY;COUNT=1" })).toEqual(["2026-07-01"]);
    expect(pendingOccurrences({ ...rule, durationDays: 2 }, "2026-07-08", "2026-07-08", new Set()).map((entry) => [entry.startDate, entry.endDate])).toEqual([["2026-07-08", "2026-07-10"]]);
    // An occurrence that started before the window but still covers it is included.
    expect(pendingOccurrences({ ...rule, durationDays: 2 }, "2026-07-03", "2026-07-03", new Set()).map((entry) => entry.startDate)).toEqual(["2026-07-01"]);
  });

  it("ignores a rule it cannot parse", () => {
    expect(dates({ ...rule, rrule: "every other full moon" })).toEqual([]);
  });
});

describe("get_calendar_availability contract", () => {
  const [tool] = calendarTools();

  it("is a read behind its own capability, scope and module", () => {
    expect(tool.name).toBe("get_calendar_availability");
    expect(tool.access).toBe("read");
    expect(tool.capability).toBe("calendar.availability");
    expect(tool.scopes).toEqual([MCP_CAPABILITIES["calendar.availability"].scope]);
    expect(tool.module).toBe(MCP_CAPABILITIES["calendar.availability"].module);
    expect(MCP_CAPABILITIES["calendar.availability"].access).toBe("read");
    expect(tool.description).toMatch(/not guaranteed free/);
    expect(tool.description).toMatch(/never a title, location, attendee, calendar name/);
  });

  it("keeps an assistant's answer inside the selected calendars", () => {
    // Acceptance 2026-11-13: one client read externalCalendarsExcluded:false as "outside calendars are included",
    // another as "nothing was left out, the list is complete". Neither follows from the result.
    expect(tool.description).toMatch(/covers only those selected calendars, never everything the user has/);
    expect(tool.description).toMatch(/must not be called complete/);
    expect(tool.description).toMatch(/outside calendar such as Google Calendar are never returned/);
    expect(tool.description).toMatch(/false does not mean outside calendars are included or covered/);
    expect(tool.description).toMatch(/when truncated is true the list was cut short/);
    // The description must never itself assert that outside events are part of a result.
    expect(tool.description).not.toMatch(/outside calendars? (events )?are included(?! or covered)/);
  });

  it("accepts one to fourteen real dates and nothing else", () => {
    expect(availabilityInput.safeParse({ from: "2026-07-01" }).success).toBe(true);
    expect(availabilityInput.safeParse({ from: "2026-07-01", to: "2026-07-14" }).success).toBe(true);
    expect(AVAILABILITY_LIMITS.days).toBe(14);
    for (const args of [{}, { to: "2026-07-01" }, { from: "2026-07-01", to: "2026-07-15" }, { from: "2026-07-02", to: "2026-07-01" }, { from: "2026-02-30" }, { from: "07/01/2026" },
      { from: "2026-07-01T00:00" }, { from: "2026-07-01", calendarId: "x" }, { from: "2026-07-01", timezone: "UTC" }, { from: "2026-07-01", includeTitles: true }, { from: 20260701 }]) {
      expect(availabilityInput.safeParse(args).success, JSON.stringify(args)).toBe(false);
    }
  });

  it("has no field that could hold a title, a place, a person or a calendar", () => {
    const base = { schemaVersion: 1, retrievedAt: new Date().toISOString(), householdTimezone: "UTC", from: "2026-07-01", to: "2026-07-01", coverage: "selected_calendars",
      recurringExpanded: true, externalCalendarsExcluded: false, truncated: false, busy: [{ start: "2026-07-01T09:00", end: "2026-07-01T10:00", allDay: false }] };
    expect(availabilityOutput.safeParse(base).success).toBe(true);
    expect(availabilityOutput.safeParse({ ...base, coverage: "no_calendars_selected", busy: [] }).success).toBe(true);
    for (const extra of [{ title: "x" }, { location: "x" }, { attendees: [] }, { calendar: "x" }, { calendarId: "x" }, { id: "x" }, { category: "x" }, { description: "x" }, { count: 1 }]) {
      expect(availabilityOutput.safeParse({ ...base, busy: [{ ...base.busy[0], ...extra }] }).success, JSON.stringify(extra)).toBe(false);
      expect(availabilityOutput.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    // Times are local wall-clock minutes; an instant with seconds or an offset is refused.
    expect(availabilityOutput.safeParse({ ...base, busy: [{ start: "2026-07-01T09:00:00Z", end: "2026-07-01T10:00", allDay: false }] }).success).toBe(false);
    expect(availabilityOutput.safeParse({ ...base, coverage: "all_calendars" }).success).toBe(false);
    expect(Object.keys(availabilityOutput.shape.busy.element.shape).sort()).toEqual(["allDay", "end", "start"]);
  });
});
