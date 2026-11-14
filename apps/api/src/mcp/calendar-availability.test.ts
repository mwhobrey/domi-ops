import { describe, expect, it } from "vitest";
import { MCP_CAPABILITIES } from "@domi-ops/config";
import { AVAILABILITY_LIMITS, availabilityInput, availabilityOutput, busyIntervals, calendarTools, pendingOccurrences, type BusySource, type RuleSource, availabilityReading } from "./calendar-availability.js";

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
    expect(tool.description).toMatch(/truncated true means the list was cut short, so say so; false does not mean the list is complete/);
    // The description must never itself assert that outside events are part of a result.
    expect(tool.description).not.toMatch(/outside calendars? (events )?are included(?! or covered)/);
  });

  // Acceptance 2026-11-14, Grok Bot on the 0.2.1 descriptions: one answer said "the list is complete", another
  // "you're open only after 3:15" ahead of a caveat. These check the wording a client is given, in the description
  // and beside every result. They say nothing about what a model will write.
  const affirmsMoreThanTheResult = [
    /\bopen (only )?(after|until|before|from)\b/i, /\bmostly (open|free|taken)\b/i, /\ball (of )?(the user's|your) calendars\b/i,
  ];
  /** Free time, completeness and "nothing left out" may be named only inside a sentence that forbids or denies them. */
  const onlyEverDenied = (text: string) => {
    for (const sentence of text.split(/(?<=[.;]) /).filter((part) => /\b(free|open|available|complete|clear|nothing was left out)\b/i.test(part))) {
      expect(sentence, sentence).toMatch(/\b(Never|Do not|not)\b/);
    }
  };

  it("leads the description with what may be reported and forbids inferring free time", () => {
    const sentences = tool.description.split(/(?<=\.) /);
    // The reporting rule comes straight after the one-line summary, before any field is explained.
    expect(sentences[1]).toBe("Report only the busy blocks returned, or that no busy block is listed for the time asked about.");
    expect(sentences[2]).toBe("Never say or imply that any time is free, open or available, even with a caveat after it: time not listed is not guaranteed free.");
    expect(tool.description).toContain("calendars that are not selected are not checked");
    expect(tool.description).toContain("coverage no_calendars_selected means nothing is shared, so say that and not that the time is clear");
    // Remove ambiguous per-flag guidance; whether it caused the observed claim is a working hypothesis.
    expect(tool.description).not.toMatch(/in each case/);
    // Every mention of a false flag is followed by what it does not mean.
    for (const match of tool.description.matchAll(/false ([^.;]+)/g)) expect(match[1], match[0]).toMatch(/^does not mean /);
    for (const pattern of affirmsMoreThanTheResult) expect(tool.description, String(pattern)).not.toMatch(pattern); onlyEverDenied(tool.description);
  });

  it("sends the reporting rule with every result, chosen by flags and never quoting the result", () => {
    const base = { schemaVersion: 1, retrievedAt: "2026-11-19T15:00:00.000Z", householdTimezone: "America/Chicago", from: "2026-11-19", to: "2026-11-20",
      coverage: "selected_calendars", recurringExpanded: true, externalCalendarsExcluded: false, truncated: false,
      busy: [{ start: "2026-11-19T09:00", end: "2026-11-19T09:15", allDay: false }, { start: "2026-11-19T12:45", end: "2026-11-19T15:15", allDay: false }, { start: "2026-11-20T00:00", end: "2026-11-21T00:00", allDay: true }] };
    expect(tool.reading).toBe(availabilityReading);
    const usual = availabilityReading(base);
    expect(usual).toBe("How to report this result: state the busy blocks listed, or that no busy block is listed for the time asked about, on the calendars the user selected for this connection. "
      + "Do not say or imply that any time is free, open or available, with or without a caveat. "
      + "Do not call this list complete or say that nothing was left out: calendars that are not selected, and events imported from outside calendars, were not checked.");
    // The same wording whether or not anything is busy: an empty list is "no busy block listed", never "free".
    expect(availabilityReading({ ...base, busy: [] })).toBe(usual);
    expect(availabilityReading({ ...base, truncated: true })).toBe(usual + " This list was cut short: say so.");
    expect(availabilityReading({ ...base, externalCalendarsExcluded: true })).toBe(usual + " Events from an outside calendar were left out of a selected calendar: say the answer may be missing them.");
    const none = availabilityReading({ ...base, coverage: "no_calendars_selected", busy: [] });
    expect(none).toBe("How to report this result: no calendar is shared with this connection, so nothing was checked. Say that. Do not say the user is free or that the time is clear.");
    for (const text of [usual, none, availabilityReading({ ...base, truncated: true, externalCalendarsExcluded: true })]) {
      // Nothing from the result is repeated: no date, time, zone or count, so the note cannot carry an event detail.
      expect(text).not.toMatch(/\d/);
      for (const value of ["Chicago", "09:00", "12:45", "15:15"]) expect(text).not.toContain(value);
      for (const pattern of affirmsMoreThanTheResult) expect(text, String(pattern)).not.toMatch(pattern); onlyEverDenied(text);
      // It only narrows what may be said. It never asks for another call or another source.
      expect(text).not.toMatch(/\b(call|fetch|read|open|use)\b (the|another|a) (tool|calendar|app|browser)/i);
    }
    // A flag that is absent or not a boolean never switches a sentence on.
    expect(availabilityReading({ ...base, truncated: "true", externalCalendarsExcluded: 1 })).toBe(usual);
  });

  it("leaves the structured result and its schema exactly as they were", () => {
    const shape = (availabilityOutput as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape).sort()).toEqual(["busy", "coverage", "externalCalendarsExcluded", "from", "householdTimezone", "recurringExpanded", "retrievedAt", "schemaVersion", "to", "truncated"]);
    for (const extra of [{ reading: "x" }, { note: "x" }, { free: [] }, { complete: true }]) {
      expect(availabilityOutput.safeParse({ schemaVersion: 1, retrievedAt: "2026-11-19T15:00:00.000Z", householdTimezone: "UTC", from: "2026-11-19", to: "2026-11-19",
        coverage: "selected_calendars", recurringExpanded: true, externalCalendarsExcluded: false, truncated: false, busy: [], ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
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
