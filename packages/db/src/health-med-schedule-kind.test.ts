import { describe, expect, it } from "vitest";
import { isAsNeededMedScheduleKind } from "./health-med-schedule-kind.js";

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
