import { describe, expect, it } from "vitest";
import { healthPainBodyRegionEnum } from "@domi-ops/db";
import { PAIN_BODY_REGION_LABELS } from "./health-reports.js";

describe("pain body regions", () => {
  it("every DB enum value has a report label", () => {
    const missing = healthPainBodyRegionEnum.enumValues.filter((v) => !(v in PAIN_BODY_REGION_LABELS));
    expect(missing).toEqual([]);
  });

  it("every report label maps to a DB enum value", () => {
    const enumValues: readonly string[] = healthPainBodyRegionEnum.enumValues;
    const stale = Object.keys(PAIN_BODY_REGION_LABELS).filter((k) => !enumValues.includes(k));
    expect(stale).toEqual([]);
  });

  it("includes the spine and left/right chest regions", () => {
    expect(healthPainBodyRegionEnum.enumValues).toEqual(
      expect.arrayContaining(["spine", "left_chest", "right_chest"]),
    );
  });
});
