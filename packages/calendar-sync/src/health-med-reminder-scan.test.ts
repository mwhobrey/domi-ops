import { describe, expect, it } from "vitest";
import { buildMedGroupReminderCopy, buildMedReminderCopy } from "./health-med-reminder-scan.js";

describe("health med reminder copy", () => {
  it("includes scheduled take time in recipient timezone (urgent)", () => {
    const scheduledAt = new Date("2026-07-10T13:00:00.000Z"); // 8:00 AM America/Chicago
    const copy = buildMedReminderCopy({
      medName: "Amoxicillin",
      minutesUntil: 0,
      scheduledAt,
      timeZone: "America/Chicago",
      isSubject: true,
      subjectLabel: "Alex",
    });

    expect(copy.title).toBe("Medication reminder • 8:00 AM");
    expect(copy.body).toContain("Time to take Amoxicillin at");
    expect(copy.body).toMatch(/Jul 10, 2026, 8:00 AM/);
  });

  it("includes scheduled take time in recipient timezone (future)", () => {
    const scheduledAt = new Date("2026-07-10T13:00:00.000Z"); // 8:00 AM America/Chicago
    const copy = buildMedReminderCopy({
      medName: "Amoxicillin",
      minutesUntil: 15,
      scheduledAt,
      timeZone: "America/Chicago",
      isSubject: true,
      subjectLabel: "Alex",
    });

    expect(copy.title).toBe("Medication reminder • 8:00 AM");
    expect(copy.body).toContain("Amoxicillin at");
    expect(copy.body).toMatch(/Jul 10, 2026, 8:00 AM/);
  });

  it("prefixes non-subject copy with subject label", () => {
    const scheduledAt = new Date("2026-07-10T13:00:00.000Z");
    const copy = buildMedReminderCopy({
      medName: "Amoxicillin",
      minutesUntil: 0,
      scheduledAt,
      timeZone: "America/Chicago",
      isSubject: false,
      subjectLabel: "Alex",
    });

    expect(copy.body).toMatch(/^Alex — /);
  });
});

describe("health med group reminder copy", () => {
  it("uses the group's own name in the title instead of the generic 'Medication reminder'", () => {
    const scheduledAt = new Date("2026-07-10T13:00:00.000Z"); // 8:00 AM America/Chicago
    const copy = buildMedGroupReminderCopy({
      groupName: "Morning meds",
      medNames: ["Lisinopril", "Metformin"],
      minutesUntil: 0,
      scheduledAt,
      timeZone: "America/Chicago",
      isSubject: true,
      subjectLabel: "Alex",
    });

    expect(copy.title).toBe("Morning meds • 8:00 AM");
    expect(copy.body).toContain("Time to take Lisinopril, Metformin at");
  });

  it("enumerates up to 3 medication names, then '+N more'", () => {
    const scheduledAt = new Date("2026-07-10T13:00:00.000Z");
    const copy = buildMedGroupReminderCopy({
      groupName: "Morning meds",
      medNames: ["Lisinopril", "Metformin", "Vitamin D", "Aspirin", "Omeprazole"],
      minutesUntil: 0,
      scheduledAt,
      timeZone: "America/Chicago",
      isSubject: true,
      subjectLabel: "Alex",
    });

    expect(copy.body).toContain("Lisinopril, Metformin, Vitamin D + 2 more at");
  });

  it("uses 'X at time' (no 'Time to take') for an advance-notice reminder", () => {
    const scheduledAt = new Date("2026-07-10T13:00:00.000Z");
    const copy = buildMedGroupReminderCopy({
      groupName: "Morning meds",
      medNames: ["Lisinopril", "Metformin"],
      minutesUntil: 15,
      scheduledAt,
      timeZone: "America/Chicago",
      isSubject: true,
      subjectLabel: "Alex",
    });

    expect(copy.body).not.toContain("Time to take");
    expect(copy.body).toContain("Lisinopril, Metformin at");
  });

  it("prefixes non-subject copy with subject label", () => {
    const scheduledAt = new Date("2026-07-10T13:00:00.000Z");
    const copy = buildMedGroupReminderCopy({
      groupName: "Morning meds",
      medNames: ["Lisinopril"],
      minutesUntil: 0,
      scheduledAt,
      timeZone: "America/Chicago",
      isSubject: false,
      subjectLabel: "Alex",
    });

    expect(copy.body).toMatch(/^Alex — /);
  });
});

