import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/client-api";
import {
  appointmentDayLabel,
  appointmentErrorMessage,
  appointmentFromConflict,
  appointmentStatus,
  effectLines,
  groupAppointments,
  medicationEffectLine,
  outcomeChoices,
} from "./appointment-helpers";
import type { Appointment, AppointmentEffects } from "./appointment-types";
import { describeChanges } from "./filling-helpers";

const appt = (over: Partial<Appointment> = {}): Appointment => ({
  planId: "p",
  nominalDate: "2026-10-06",
  date: "2026-10-06",
  windowStart: "2026-10-06",
  windowEnd: "2026-10-06",
  outcome: "pending",
  status: "upcoming",
  doneBy: null,
  rescheduledTo: null,
  note: null,
  resolvedAt: null,
  needsResolution: false,
  version: 0,
  changedAt: null,
  ...over,
});

describe("groupAppointments", () => {
  it("puts what needs dealing with first, what is coming next and what is behind last", () => {
    const g = groupAppointments([
      appt({ nominalDate: "2026-11-05", date: "2026-11-05" }),
      appt({ nominalDate: "2026-10-06", date: "2026-10-06", status: "done", outcome: "done" }),
      appt({ nominalDate: "2026-09-06", date: "2026-09-06", status: "overdue", needsResolution: true }),
      appt({ nominalDate: "2026-12-05", date: "2026-12-05" }),
      appt({ nominalDate: "2026-08-06", date: "2026-08-06", status: "skipped", outcome: "skipped", resolvedAt: "2026-08-07T00:00:00Z" }),
    ]);
    expect(g.attention.map((a) => a.date)).toEqual(["2026-09-06"]);
    expect(g.upcoming.map((a) => a.date)).toEqual(["2026-11-05", "2026-12-05"]);
    expect(g.recent.map((a) => a.date)).toEqual(["2026-10-06", "2026-08-06"]);
  });
  it("counts today as coming up, and a dealt-with overdue one as behind", () => {
    const g = groupAppointments([appt({ status: "today" }), appt({ nominalDate: "2026-09-01", date: "2026-09-01", status: "overdue", needsResolution: false })]);
    expect(g.upcoming).toHaveLength(1);
    expect(g.recent).toHaveLength(1);
  });
  it("handles an empty list", () => {
    expect(groupAppointments([])).toEqual({ attention: [], upcoming: [], recent: [] });
  });
});

describe("appointmentStatus", () => {
  it("names each state", () => {
    expect(appointmentStatus({ status: "overdue", outcome: "pending", doneBy: null })).toEqual({ label: "Overdue", tone: "danger" });
    expect(appointmentStatus({ status: "done", outcome: "done", doneBy: "session" }).label).toBe("Done (filled)");
    expect(appointmentStatus({ status: "done", outcome: "done", doneBy: "user" }).label).toBe("Done");
    expect(appointmentStatus({ status: "skipped", outcome: "skipped", doneBy: null }).tone).toBe("warning");
    expect(appointmentStatus({ status: "missed", outcome: "missed", doneBy: null }).label).toBe("Missed");
  });
  it("says a moved appointment ahead is moved", () => {
    expect(appointmentStatus({ status: "upcoming", outcome: "rescheduled", doneBy: null }).label).toBe("Moved");
    expect(appointmentStatus({ status: "today", outcome: "rescheduled", doneBy: null }).label).toBe("Today (moved)");
  });
  it("judges a moved appointment that is behind by its own status", () => {
    expect(appointmentStatus({ status: "overdue", outcome: "rescheduled", doneBy: null }).label).toBe("Overdue");
  });
});

describe("labels and choices", () => {
  it("shows where a moved appointment came from", () => {
    expect(appointmentDayLabel({ date: "2026-10-06", nominalDate: "2026-10-06" })).toBe("Oct 6");
    expect(appointmentDayLabel({ date: "2026-10-09", nominalDate: "2026-10-06" })).toBe("Oct 9 (moved from Oct 6)");
  });
  it("does not offer 'missed' before the day", () => {
    expect(outcomeChoices({ status: "upcoming", outcome: "pending" })).not.toContain("missed");
    expect(outcomeChoices({ status: "overdue", outcome: "pending" })).toContain("missed");
  });
  it("keeps 'missed' when it was already said", () => {
    expect(outcomeChoices({ status: "upcoming", outcome: "missed" })).toContain("missed");
  });
});

describe("effects", () => {
  const effects: AppointmentEffects = {
    nextFillDate: "2026-11-05",
    coverageEndsOn: "2026-10-31",
    earliestRefillDeadline: "2026-10-28",
    medications: [],
    actions: ["resolve"],
  };
  it("says in sentences what it affects", () => {
    expect(effectLines(effects)).toEqual([
      "Pills next go into the organizer on Nov 5.",
      "What is in the organizers lasts until Oct 31.",
      "The earliest refill to ask for is by Oct 28.",
    ]);
  });
  it("says so when the organizers are empty, and leaves out what is not known", () => {
    expect(effectLines({ ...effects, nextFillDate: null, coverageEndsOn: null, earliestRefillDeadline: null })).toEqual(["There are no pills in the organizers now."]);
    expect(effectLines(null)).toEqual([]);
  });
  it("describes a medication that would go without", () => {
    const m = { medicationId: "m", name: "Metformin", coverageEndsOn: "2026-10-31", daysWithoutPills: 4, runsOutOn: "2026-10-20", refillDeadline: "2026-10-15", refillRequested: false };
    expect(medicationEffectLine(m)).toBe(
      "Metformin: 4 days without pills in the organizer before the next fill. Supply runs out Oct 20. Ask for a refill by Oct 15.",
    );
    expect(medicationEffectLine({ ...m, refillRequested: true })).toContain("Refill already requested.");
    expect(medicationEffectLine({ ...m, daysWithoutPills: 0, runsOutOn: null, refillDeadline: null })).toBe("Metformin: nothing to do.");
    expect(medicationEffectLine({ ...m, daysWithoutPills: 1 })).toContain("1 day without");
  });
});

describe("answers from the API", () => {
  const err = (body: unknown) => new ApiError("x", 409, JSON.stringify(body));
  it("takes the appointment a conflict carries", () => {
    const got = appointmentFromConflict(err({ error: "version_conflict", appointment: appt({ version: 3 }), effects: null }));
    expect(got?.appointment.version).toBe(3);
    expect(got?.effects).toBeNull();
  });
  it("ignores anything else", () => {
    expect(appointmentFromConflict(err({ error: "date_taken" }))).toBeNull();
    expect(appointmentFromConflict(err({ appointment: { version: "x" } }))).toBeNull();
    expect(appointmentFromConflict(err({ appointment: { nominalDate: "2026-10-06", version: "3" } }))).toBeNull();
    expect(appointmentFromConflict(new ApiError("x", 500, "nope"))).toBeNull();
    expect(appointmentFromConflict(new Error("x"))).toBeNull();
  });
  it("gives a sentence, never a code", () => {
    expect(appointmentErrorMessage(err({ error: "date_taken" }), "fallback")).toMatch(/already on that day/);
    expect(appointmentErrorMessage(err({ error: "new_code" }), "fallback")).toBe("fallback");
  });
});

describe("describeChanges", () => {
  const name = (id: string) => ({ a: "Aspirin", b: "Calcium" })[id as "a" | "b"] ?? "A medication";
  it("lists each medication's changes and the compartments renamed, added or removed", () => {
    const lines = describeChanges(
      {
        changed: true,
        medications: [
          { medicationId: "a", kinds: ["schedule", "quantity"], added: 2, removed: 1, quantityChanged: 3, compartmentChanged: 0, dates: ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"] },
          { medicationId: "b", kinds: ["compartment"], added: 0, removed: 0, quantityChanged: 0, compartmentChanged: 1, dates: [] },
          { medicationId: "zzz", kinds: ["schedule"], added: 1, removed: 0, quantityChanged: 0, compartmentChanged: 0, dates: [] },
        ],
        compartments: [
          { id: "1", from: "Lunch", to: "Midday" },
          { id: "2", from: "Night", to: null },
          { id: "3", from: null, to: "Bedtime" },
        ],
      },
      name,
    );
    expect(lines).toEqual([
      "Aspirin: 2 doses added, 1 dose removed, 3 doses with a different amount (for example Oct 7, Oct 8, Oct 9)",
      "Calcium: 1 dose in a different compartment",
      "A medication: 1 dose added",
      'Compartment "Lunch" is now "Midday"',
      'Compartment "Night" was removed',
      'Compartment "Bedtime" was added',
    ]);
  });
  it("is empty when nothing changed", () => {
    expect(describeChanges(null, name)).toEqual([]);
    expect(describeChanges({ changed: false, medications: [], compartments: [] }, name)).toEqual([]);
  });
});
