import { describe, expect, it } from "vitest";
import { normalizeMedSchedule } from "./health-serialize.js";

describe("normalizeMedSchedule (WHO-319 OTC)", () => {
  it("stores OTC meds with empty schedule like PRN", () => {
    expect(normalizeMedSchedule({ scheduleKind: "otc" })).toEqual({
      scheduleKind: "otc",
      scheduleJson: "{}",
    });
  });

  it("still accepts PRN", () => {
    expect(normalizeMedSchedule({ scheduleKind: "prn" })).toEqual({
      scheduleKind: "prn",
      scheduleJson: "{}",
    });
  });
});
