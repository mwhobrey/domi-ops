import { describe, expect, it } from "vitest";
import { applyTemperatureUnit, convertCelsiusTemp } from "./weather-units.js";

describe("weather-units", () => {
  it("converts celsius to fahrenheit", () => {
    expect(convertCelsiusTemp(0, "fahrenheit")).toBeCloseTo(32, 5);
    expect(convertCelsiusTemp(20, "fahrenheit")).toBeCloseTo(68, 5);
  });

  it("leaves celsius unchanged", () => {
    expect(convertCelsiusTemp(20, "celsius")).toBe(20);
  });

  it("applies unit to forecast payload", () => {
    const out = applyTemperatureUnit(
      {
        locationLabel: null,
        timezone: "UTC",
        current: { temperature: 10, feelsLike: 9, weatherCode: 0, windSpeed: 5 },
        todayHourly: [{ time: "2026-01-01T12:00", temperature: 10, precipProbability: 0, weatherCode: 0 }],
        dayHourly: [{ time: "2026-01-01T14:00", temperature: 12, precipProbability: 0, weatherCode: 1 }],
      },
      "fahrenheit",
    );
    expect(out.temperatureUnit).toBe("fahrenheit");
    expect(out.current?.temperature).toBeCloseTo(50, 5);
    expect(out.todayHourly[0]?.temperature).toBeCloseTo(50, 5);
  });
});
