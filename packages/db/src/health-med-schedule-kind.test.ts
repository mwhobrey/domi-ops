import { describe, expect, it } from "vitest";
import { isAsNeededMedScheduleKind, narrowGroupScheduleMeta } from "./health-med-schedule-kind.js";

describe("isAsNeededMedScheduleKind", () => {
  it("treats PRN and OTC as as-needed", () => {
    expect(isAsNeededMedScheduleKind("prn")).toBe(true);
    expect(isAsNeededMedScheduleKind("otc")).toBe(true);
  });

  it("rejects scheduled and interval kinds", () => {
    expect(isAsNeededMedScheduleKind("scheduled")).toBe(false);
    expect(isAsNeededMedScheduleKind("interval")).toBe(false);
    expect(isAsNeededMedScheduleKind(null)).toBe(false);
  });
});

describe("narrowGroupScheduleMeta", () => {
  it("accepts scheduled and interval only", () => {
    expect(
      narrowGroupScheduleMeta({ scheduleKind: "scheduled", scheduleJson: '{"times":["08:00"]}' }),
    ).toEqual({ scheduleKind: "scheduled", scheduleJson: '{"times":["08:00"]}' });
  });

  it("rejects as-needed kinds", () => {
    expect(narrowGroupScheduleMeta({ scheduleKind: "prn", scheduleJson: "{}" })).toBeNull();
    expect(narrowGroupScheduleMeta({ scheduleKind: "otc", scheduleJson: "{}" })).toBeNull();
  });
});
