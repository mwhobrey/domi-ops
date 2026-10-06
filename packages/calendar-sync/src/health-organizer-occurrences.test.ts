import { describe, expect, it } from "vitest";
import {
  MAX_OCCURRENCE_DATES,
  deriveOccurrence,
  isOrganizerOccurrenceDate,
  nextOrganizerOccurrenceAfter,
  organizerOccurrenceDates,
  organizerOccurrenceWindow,
  type OrganizerSchedule,
} from "./health-organizer-occurrences.js";

const every = (everyN: number): OrganizerSchedule => ({ kind: "every_n_days", everyN });
const monthly = (monthlyDay: number): OrganizerSchedule => ({ kind: "monthly_date", monthlyDay });

describe("organizerOccurrenceDates: every N days", () => {
  it("counts from the anchor, the anchor itself first", () => {
    expect(organizerOccurrenceDates(every(30), "2026-01-01", "2026-01-01", "2026-04-30")).toEqual(["2026-01-01", "2026-01-31", "2026-03-02", "2026-04-01"]);
  });

  it("starts at the first one on or after `from`, keeping the rhythm", () => {
    expect(organizerOccurrenceDates(every(30), "2026-01-01", "2026-01-31", "2026-03-02")).toEqual(["2026-01-31", "2026-03-02"]);
    expect(organizerOccurrenceDates(every(30), "2026-01-01", "2026-02-01", "2026-03-02")).toEqual(["2026-03-02"]);
    expect(organizerOccurrenceDates(every(30), "2026-01-01", "2026-06-01", "2026-06-30")).toEqual(["2026-06-30"]);
  });

  it("never goes before the anchor", () => {
    expect(organizerOccurrenceDates(every(7), "2026-03-10", "2026-01-01", "2026-03-24")).toEqual(["2026-03-10", "2026-03-17", "2026-03-24"]);
    expect(organizerOccurrenceDates(every(7), "2026-03-10", "2026-01-01", "2026-03-09")).toEqual([]);
  });

  it("handles every day, one far-off appointment and a leap day", () => {
    expect(organizerOccurrenceDates(every(1), "2028-02-27", "2028-02-27", "2028-03-01")).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(organizerOccurrenceDates(every(365), "2026-01-01", "2026-01-02", "2027-01-01")).toEqual(["2027-01-01"]);
  });

  it("is empty for an empty or backwards range", () => {
    expect(organizerOccurrenceDates(every(30), "2026-01-01", "2026-02-01", "2026-01-31")).toEqual([]);
    expect(organizerOccurrenceDates(every(30), "2026-01-01", "2026-01-05", "2026-01-20")).toEqual([]);
  });
});

describe("organizerOccurrenceDates: a day of the month", () => {
  it("uses the last day of a month that is too short", () => {
    expect(organizerOccurrenceDates(monthly(31), "2026-01-31", "2026-01-01", "2026-06-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
    expect(organizerOccurrenceDates(monthly(30), "2026-01-01", "2026-02-01", "2026-03-31")).toEqual(["2026-02-28", "2026-03-30"]);
    expect(organizerOccurrenceDates(monthly(29), "2026-01-01", "2026-02-01", "2026-02-28")).toEqual(["2026-02-28"]);
  });

  it("uses the leap day in a leap year", () => {
    expect(organizerOccurrenceDates(monthly(31), "2028-01-01", "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
    expect(organizerOccurrenceDates(monthly(29), "2028-01-01", "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
    expect(organizerOccurrenceDates(monthly(30), "2028-01-01", "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });

  it("skips this month's date when the anchor is already past it", () => {
    expect(organizerOccurrenceDates(monthly(15), "2026-01-31", "2026-01-01", "2026-03-31")).toEqual(["2026-02-15", "2026-03-15"]);
    expect(organizerOccurrenceDates(monthly(15), "2026-01-15", "2026-01-01", "2026-02-28")).toEqual(["2026-01-15", "2026-02-15"]);
  });

  it("only returns days inside the range, across a new year", () => {
    expect(organizerOccurrenceDates(monthly(10), "2026-01-01", "2026-12-11", "2027-02-09")).toEqual(["2027-01-10"]);
    expect(organizerOccurrenceDates(monthly(10), "2026-01-01", "2026-11-10", "2027-01-10")).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
  });
});

describe("organizerOccurrenceDates: guards", () => {
  it("refuses real nonsense", () => {
    expect(() => organizerOccurrenceDates(every(0), "2026-01-01", "2026-01-01", "2026-02-01")).toThrow(RangeError);
    expect(() => organizerOccurrenceDates(every(1.5), "2026-01-01", "2026-01-01", "2026-02-01")).toThrow(RangeError);
    expect(() => organizerOccurrenceDates(monthly(32), "2026-01-01", "2026-01-01", "2026-02-01")).toThrow(RangeError);
    expect(() => organizerOccurrenceDates(monthly(0), "2026-01-01", "2026-01-01", "2026-02-01")).toThrow(RangeError);
    expect(() => organizerOccurrenceDates(every(30), "2026-02-30", "2026-01-01", "2026-02-01")).toThrow(RangeError);
    expect(() => organizerOccurrenceDates(every(30), "2026-01-01", "soon", "2026-02-01")).toThrow(RangeError);
  });

  it("stops at the cap rather than looping for ever", () => {
    expect(organizerOccurrenceDates(every(1), "2000-01-01", "2000-01-01", "2030-01-01")).toHaveLength(MAX_OCCURRENCE_DATES);
  });
});

describe("isOrganizerOccurrenceDate and nextOrganizerOccurrenceAfter", () => {
  it("knows which days are appointments", () => {
    expect(isOrganizerOccurrenceDate(every(30), "2026-01-01", "2026-01-31")).toBe(true);
    expect(isOrganizerOccurrenceDate(every(30), "2026-01-01", "2026-02-01")).toBe(false);
    expect(isOrganizerOccurrenceDate(every(30), "2026-01-01", "2025-12-02")).toBe(false);
    expect(isOrganizerOccurrenceDate(monthly(31), "2026-01-01", "2026-02-28")).toBe(true);
    expect(isOrganizerOccurrenceDate(monthly(31), "2026-01-01", "2026-02-27")).toBe(false);
  });

  it("finds the next one after any day, an appointment included", () => {
    expect(nextOrganizerOccurrenceAfter(every(30), "2026-01-01", "2026-01-31")).toBe("2026-03-02");
    expect(nextOrganizerOccurrenceAfter(every(30), "2026-01-01", "2026-01-15")).toBe("2026-01-31");
    expect(nextOrganizerOccurrenceAfter(monthly(31), "2026-01-01", "2026-12-31")).toBe("2027-01-31");
    expect(nextOrganizerOccurrenceAfter(monthly(31), "2026-01-01", "2026-01-31")).toBe("2026-02-28");
    expect(nextOrganizerOccurrenceAfter(every(30), "2026-06-01", "2026-01-01")).toBe("2026-06-01");
  });
});

describe("organizerOccurrenceWindow", () => {
  const hours = (date: string, tz: string) => {
    const w = organizerOccurrenceWindow(date, tz);
    return (w.end.getTime() - w.start.getTime()) / 3_600_000;
  };

  it("is the whole local day", () => {
    const w = organizerOccurrenceWindow("2026-06-10", "America/New_York");
    expect(w.start.toISOString()).toBe("2026-06-10T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-06-11T04:00:00.000Z");
    expect(hours("2026-06-10", "UTC")).toBe(24);
  });

  it("is 23 hours when the clocks go forward and 25 when they go back", () => {
    expect(hours("2026-03-08", "America/New_York")).toBe(23);
    expect(hours("2026-11-01", "America/New_York")).toBe(25);
    expect(hours("2026-03-29", "Europe/London")).toBe(23);
    expect(hours("2026-10-25", "Europe/London")).toBe(25);
    expect(hours("2026-04-05", "Australia/Lord_Howe")).toBe(24.5);
    expect(hours("2026-10-04", "Australia/Lord_Howe")).toBe(23.5);
  });

  it("leaves no gap and no overlap between one day and the next, even where midnight does not exist", () => {
    for (const tz of ["America/New_York", "Europe/London", "Australia/Lord_Howe", "America/Havana", "America/Sao_Paulo", "Asia/Tokyo", "UTC"]) {
      for (const date of ["2026-03-07", "2026-03-08", "2026-03-28", "2026-03-29", "2026-10-03", "2026-10-04", "2026-10-31", "2026-11-01", "2026-11-07"]) {
        const a = organizerOccurrenceWindow(date, tz);
        const b = organizerOccurrenceWindow(new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), tz);
        expect(a.end.getTime(), `${tz} ${date}`).toBe(b.start.getTime());
        expect(a.end.getTime(), `${tz} ${date}`).toBeGreaterThan(a.start.getTime());
      }
    }
  });

  it("refuses a date that is not one", () => {
    expect(() => organizerOccurrenceWindow("2026-02-30", "UTC")).toThrow(RangeError);
  });
});

describe("deriveOccurrence", () => {
  const base = { outcome: "pending" as const, date: "2026-06-10", timeZone: "UTC", linkedSessionFinished: false, sessionFinishedDates: [] as string[] };
  const at = (iso: string) => new Date(iso);

  it("lets the person's own answer win over everything else", () => {
    const now = at("2026-06-20T00:00:00Z");
    expect(deriveOccurrence({ ...base, now, outcome: "done" })).toEqual({ status: "done", doneBy: "user" });
    expect(deriveOccurrence({ ...base, now, outcome: "skipped", sessionFinishedDates: ["2026-06-10"], linkedSessionFinished: true })).toEqual({ status: "skipped", doneBy: null });
    expect(deriveOccurrence({ ...base, now, outcome: "missed", sessionFinishedDates: ["2026-06-10"] })).toEqual({ status: "missed", doneBy: null });
  });

  it("is upcoming, then today, then overdue, changing exactly at the window's edges", () => {
    expect(deriveOccurrence({ ...base, now: at("2026-06-09T23:59:59.999Z") }).status).toBe("upcoming");
    expect(deriveOccurrence({ ...base, now: at("2026-06-10T00:00:00Z") }).status).toBe("today");
    expect(deriveOccurrence({ ...base, now: at("2026-06-10T23:59:59.999Z") }).status).toBe("today");
    expect(deriveOccurrence({ ...base, now: at("2026-06-11T00:00:00Z") }).status).toBe("overdue");
  });

  it("counts as done at its end when a session was finished that day or the next, not before and not later", () => {
    const after = at("2026-06-11T00:00:00Z");
    expect(deriveOccurrence({ ...base, now: at("2026-06-10T20:00:00Z"), sessionFinishedDates: ["2026-06-10"] }).status).toBe("today");
    expect(deriveOccurrence({ ...base, now: after, sessionFinishedDates: ["2026-06-10"] })).toEqual({ status: "done", doneBy: "session" });
    expect(deriveOccurrence({ ...base, now: after, sessionFinishedDates: ["2026-06-11"] })).toEqual({ status: "done", doneBy: "session" });
    expect(deriveOccurrence({ ...base, now: after, sessionFinishedDates: ["2026-06-09"] }).status).toBe("overdue");
    expect(deriveOccurrence({ ...base, now: after, sessionFinishedDates: ["2026-06-12"] }).status).toBe("overdue");
    expect(deriveOccurrence({ ...base, now: after, sessionFinishedDates: [] }).status).toBe("overdue");
  });

  it("is done at once when the session was started from the appointment", () => {
    expect(deriveOccurrence({ ...base, now: at("2026-06-10T08:00:00Z"), linkedSessionFinished: true })).toEqual({ status: "done", doneBy: "session" });
    expect(deriveOccurrence({ ...base, now: at("2026-06-01T08:00:00Z"), linkedSessionFinished: true }).status).toBe("done");
  });

  it("judges a rescheduled appointment on the day it moved to", () => {
    const moved = { ...base, outcome: "rescheduled" as const, date: "2026-06-15" };
    expect(deriveOccurrence({ ...moved, now: at("2026-06-12T00:00:00Z") }).status).toBe("upcoming");
    expect(deriveOccurrence({ ...moved, now: at("2026-06-16T00:00:00Z") }).status).toBe("overdue");
    expect(deriveOccurrence({ ...moved, now: at("2026-06-16T00:00:00Z"), sessionFinishedDates: ["2026-06-16"] }).status).toBe("done");
  });

  it("uses the household's zone for the day, daylight saving included", () => {
    const ny = { ...base, date: "2026-03-08", timeZone: "America/New_York" };
    // 2026-03-08 in New York runs 05:00Z to 04:00Z next day (23 hours).
    expect(deriveOccurrence({ ...ny, now: at("2026-03-08T04:59:59Z") }).status).toBe("upcoming");
    expect(deriveOccurrence({ ...ny, now: at("2026-03-08T05:00:00Z") }).status).toBe("today");
    expect(deriveOccurrence({ ...ny, now: at("2026-03-09T03:59:59Z") }).status).toBe("today");
    expect(deriveOccurrence({ ...ny, now: at("2026-03-09T04:00:00Z") }).status).toBe("overdue");
  });
});
