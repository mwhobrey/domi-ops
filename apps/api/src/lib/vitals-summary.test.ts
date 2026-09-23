import { describe, expect, it } from "vitest";
import { summarizeVitals } from "./vitals-summary.js";

describe("summarizeVitals", () => {
  it("pairs blood pressure and abbreviates the rest", () => {
    expect(
      summarizeVitals([
        { metric: "blood_pressure_systolic", value: 135, unit: "mmHg" },
        { metric: "blood_pressure_diastolic", value: 90, unit: "mmHg" },
        { metric: "heart_rate", value: 65, unit: "bpm" },
        { metric: "blood_oxygen", value: 98, unit: "%" },
        { metric: "temperature", value: 98.6, unit: "°F" },
        { metric: "weight", value: 180, unit: "lb" },
      ]),
    ).toBe("Vitals · 135/90 · HR 65 · SpO₂ 98% · Temp 98.6°F · Wt 180 lb");
  });

  it("returns null without usable readings", () => {
    expect(summarizeVitals([{ metric: "heart_rate", value: null, unit: "bpm" }])).toBeNull();
    expect(summarizeVitals([])).toBeNull();
  });
});
