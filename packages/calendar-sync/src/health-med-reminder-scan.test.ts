import { describe, expect, it } from "vitest";
import { buildMedReminderCopy } from "./health-med-reminder-scan.js";

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

