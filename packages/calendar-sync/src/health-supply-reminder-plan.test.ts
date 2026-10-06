import { describe, expect, it } from "vitest";
import {
  buildFillReminderCopy,
  buildFillReminderDeepLink,
  buildRefillReminderCopy,
  buildRefillReminderDeepLink,
  planFillReminder,
  planRefillReminder,
  reminderInstant,
} from "./health-supply-reminder-plan.js";

const CHICAGO = "America/Chicago";
const TOKYO = "Asia/Tokyo";
const LA = "America/Los_Angeles";
const at = (iso: string) => new Date(iso);

describe("reminderInstant", () => {
  it("is the household's wall clock on that day", () => {
    expect(reminderInstant("2026-10-06", "09:00", CHICAGO).toISOString()).toBe("2026-10-06T14:00:00.000Z"); // CDT, UTC-5
    expect(reminderInstant("2026-12-06", "09:00", CHICAGO).toISOString()).toBe("2026-12-06T15:00:00.000Z"); // CST, UTC-6
    expect(reminderInstant("2026-10-06", "09:00:00", TOKYO).toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(reminderInstant("2026-10-06", "7:30", LA).toISOString()).toBe("2026-10-06T14:30:00.000Z");
  });
});

describe("planFillReminder", () => {
  const base = { date: "2026-10-06", reminderTime: "09:00", timeZone: CHICAGO, status: "today" as const };

  it("waits for the plan's reminder time on the day", () => {
    expect(planFillReminder({ ...base, now: at("2026-10-06T13:59:00Z") })).toEqual({ due: false });
    expect(planFillReminder({ ...base, now: at("2026-10-06T14:00:00Z") })).toEqual({ due: true, late: false });
    expect(planFillReminder({ ...base, now: at("2026-10-06T22:00:00Z") })).toEqual({ due: true, late: false });
  });

  it("follows a different reminder time", () => {
    expect(planFillReminder({ ...base, reminderTime: "18:30", now: at("2026-10-06T23:29:00Z") })).toEqual({ due: false });
    expect(planFillReminder({ ...base, reminderTime: "18:30", now: at("2026-10-06T23:30:00Z") })).toEqual({ due: true, late: false });
  });

  it("is never due before the day", () => {
    expect(planFillReminder({ ...base, status: "upcoming", now: at("2026-10-05T20:00:00Z") })).toEqual({ due: false });
  });

  it("is not due for an appointment that is done, skipped or missed", () => {
    for (const status of ["done", "skipped", "missed"] as const) {
      expect(planFillReminder({ ...base, status, now: at("2026-10-06T20:00:00Z") })).toEqual({ due: false });
    }
  });

  it("catches up on a reminder that came due while nothing was running, saying it is late", () => {
    expect(planFillReminder({ ...base, status: "overdue", now: at("2026-10-07T20:00:00Z") })).toEqual({ due: true, late: true });
    expect(planFillReminder({ ...base, status: "overdue", now: at("2026-10-09T05:00:00Z") })).toEqual({ due: true, late: true });
  });

  it("lets an old appointment go rather than announcing history", () => {
    expect(planFillReminder({ ...base, status: "overdue", now: at("2026-10-10T20:00:00Z") })).toEqual({ due: false });
  });

  it("is the household's day, whoever is looking: the same instant is different days in Tokyo and Los Angeles", () => {
    const now = at("2026-10-06T00:30:00Z"); // 09:30 Oct 6 in Tokyo, 17:30 Oct 5 in Los Angeles
    expect(planFillReminder({ ...base, timeZone: TOKYO, now })).toEqual({ due: true, late: false });
    expect(planFillReminder({ ...base, timeZone: LA, status: "upcoming", now })).toEqual({ due: false });
  });

  it("holds across the end of daylight saving time", () => {
    // Chicago falls back on 2026-11-01: 09:00 that day is 15:00Z, not 14:00Z.
    const b = { ...base, date: "2026-11-01" };
    expect(planFillReminder({ ...b, now: at("2026-11-01T14:30:00Z") })).toEqual({ due: false });
    expect(planFillReminder({ ...b, now: at("2026-11-01T15:00:00Z") })).toEqual({ due: true, late: false });
  });
});

describe("planRefillReminder", () => {
  // Runs out Oct 26 with a 7 day lead: the deadline is Oct 19.
  const base = {
    runsOutOn: "2026-10-26",
    leadDays: 7,
    medicationEndDate: null,
    active: true,
    requested: false,
    needsConfirmation: false,
    timeZone: CHICAGO,
  };

  it("goes at 9:00 on the deadline's day, not before", () => {
    expect(planRefillReminder({ ...base, now: at("2026-10-18T20:00:00Z") })).toBeNull();
    expect(planRefillReminder({ ...base, now: at("2026-10-19T13:59:00Z") })).toBeNull();
    expect(planRefillReminder({ ...base, now: at("2026-10-19T14:00:00Z") })).toBe("refill");
  });

  it("is due on the next scan after downtime, however long", () => {
    expect(planRefillReminder({ ...base, now: at("2026-10-21T03:00:00Z") })).toBe("refill");
    expect(planRefillReminder({ ...base, now: at("2026-10-25T20:00:00Z") })).toBe("refill");
  });

  it("is due at once for an estimate entered inside the lead window, with no 9:00 to wait for", () => {
    expect(planRefillReminder({ ...base, runsOutOn: "2026-10-22", now: at("2026-10-20T01:00:00Z") })).toBe("refill");
    expect(planRefillReminder({ ...base, runsOutOn: "2026-10-01", now: at("2026-10-20T01:00:00Z") })).toBe("refill");
  });

  it("is silent once the refill is requested, until the nudge", () => {
    const requested = { ...base, requested: true };
    expect(planRefillReminder({ ...requested, now: at("2026-10-19T20:00:00Z") })).toBeNull();
    expect(planRefillReminder({ ...requested, now: at("2026-10-23T20:00:00Z") })).toBeNull();
  });

  it("nudges a requested refill that has not arrived two days before the supply runs out, at 9:00", () => {
    const requested = { ...base, requested: true };
    expect(planRefillReminder({ ...requested, now: at("2026-10-24T13:59:00Z") })).toBeNull();
    expect(planRefillReminder({ ...requested, now: at("2026-10-24T14:00:00Z") })).toBe("waiting");
    expect(planRefillReminder({ ...requested, now: at("2026-10-26T06:00:00Z") })).toBe("waiting");
  });

  it("does not nudge after the supply has run out", () => {
    expect(planRefillReminder({ ...base, requested: true, now: at("2026-10-27T20:00:00Z") })).toBeNull();
  });

  it("is not due before the lead window opens", () => {
    expect(planRefillReminder({ ...base, runsOutOn: "2026-12-26", now: at("2026-10-20T20:00:00Z") })).toBeNull();
  });

  it("is never due for a paused or deleted medication, one past its end date, or an estimate that needs confirming", () => {
    const now = at("2026-10-22T20:00:00Z");
    expect(planRefillReminder({ ...base, active: false, now })).toBeNull();
    expect(planRefillReminder({ ...base, medicationEndDate: "2026-10-20", now })).toBeNull();
    expect(planRefillReminder({ ...base, needsConfirmation: true, now })).toBeNull();
    expect(planRefillReminder({ ...base, requested: true, active: false, now: at("2026-10-25T20:00:00Z") })).toBeNull();
    expect(planRefillReminder({ ...base, requested: true, needsConfirmation: true, now: at("2026-10-25T20:00:00Z") })).toBeNull();
  });

  it("is never due without an estimate", () => {
    expect(planRefillReminder({ ...base, runsOutOn: null, now: at("2026-10-22T20:00:00Z") })).toBeNull();
    expect(planRefillReminder({ ...base, runsOutOn: null, requested: true, now: at("2026-10-22T20:00:00Z") })).toBeNull();
  });

  it("uses the household's 9:00 in every time zone", () => {
    // Tokyo is UTC+9: 9:00 on Oct 19 there is 00:00Z that day.
    expect(planRefillReminder({ ...base, timeZone: TOKYO, now: at("2026-10-18T23:59:00Z") })).toBeNull();
    expect(planRefillReminder({ ...base, timeZone: TOKYO, now: at("2026-10-19T00:00:00Z") })).toBe("refill");
    // Los Angeles is UTC-7 then: 16:00Z.
    expect(planRefillReminder({ ...base, timeZone: LA, now: at("2026-10-19T15:59:00Z") })).toBeNull();
    expect(planRefillReminder({ ...base, timeZone: LA, now: at("2026-10-19T16:00:00Z") })).toBe("refill");
  });
});

describe("copy and links", () => {
  const now = at("2026-10-19T15:00:00Z");

  it("fills a person's own reminder plainly and prefixes someone else's with the person", () => {
    expect(buildFillReminderCopy({ isSubject: true, subjectLabel: "Ally Rivera", late: false }).title).toBe("Time to fill the pill organizer");
    expect(buildFillReminderCopy({ isSubject: false, subjectLabel: "Ally Rivera", late: false }).title).toBe("Ally: Time to fill the pill organizer");
    expect(buildFillReminderCopy({ isSubject: true, subjectLabel: "Ally", late: true }).title).toBe("Pill organizer fill was due");
  });

  it("says how long the supply lasts", () => {
    const copy = (runsOutOn: string, kind: "refill" | "waiting" = "refill", isSubject = true) =>
      buildRefillReminderCopy({ kind, medicationName: "Metformin", runsOutOn, isSubject, subjectLabel: "Ally Rivera", now, timeZone: CHICAGO });
    expect(copy("2026-10-26")).toEqual({ title: "Time to refill Metformin", body: "The supply runs out in 7 days. Ask the pharmacy for a refill and mark it requested." });
    expect(copy("2026-10-20").body).toContain("runs out tomorrow");
    expect(copy("2026-10-19").body).toContain("has run out");
    expect(copy("2026-10-15").body).toContain("has run out");
    expect(copy("2026-10-21", "waiting")).toEqual({
      title: "Still waiting on Metformin",
      body: "The refill was requested and has not arrived. The supply runs out in 2 days.",
    });
    expect(copy("2026-10-26", "refill", false).title).toBe("Ally: Time to refill Metformin");
  });

  it("links to the appointment and to the supply record", () => {
    expect(buildFillReminderDeepLink({ planId: "p1", occurrenceDate: "2026-10-06", memberId: "m1" })).toBe("/health?fill=p1&appointment=2026-10-06&member=m1");
    expect(buildRefillReminderDeepLink({ medicationId: "med 1" })).toBe("/health?supply=med+1");
  });
});
