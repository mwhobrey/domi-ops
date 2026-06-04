import { describe, expect, it } from "vitest";
import { matchSlotForEvent } from "./weather-hourly-match";

describe("matchSlotForEvent", () => {
  const hourly = [
    { time: "2026-06-04T08:00", temperature: 12, precipProbability: 0, weatherCode: 1 },
    { time: "2026-06-04T14:00", temperature: 20, precipProbability: 0, weatherCode: 2 },
  ];

  it("matches same hour", () => {
    const slot = matchSlotForEvent("14:00", hourly);
    expect(slot?.temperature).toBe(20);
  });

  it("matches within one hour", () => {
    const slot = matchSlotForEvent("13:30", hourly);
    expect(slot?.temperature).toBe(20);
  });

  it("returns null when too far", () => {
    expect(matchSlotForEvent("22:00", hourly)).toBeNull();
  });
});
