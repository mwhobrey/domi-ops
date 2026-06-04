import type { WeatherPayload } from "./open-meteo.js";

export type TemperatureUnit = "fahrenheit" | "celsius";

export function normalizeTemperatureUnit(value: string | undefined | null): TemperatureUnit {
  return value === "celsius" ? "celsius" : "fahrenheit";
}

function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

export function convertCelsiusTemp(celsius: number, unit: TemperatureUnit): number {
  return unit === "fahrenheit" ? celsiusToFahrenheit(celsius) : celsius;
}

export function applyTemperatureUnit(
  forecast: WeatherPayload,
  unit: TemperatureUnit,
): WeatherPayload & { temperatureUnit: TemperatureUnit } {
  if (!forecast.current) {
    return { ...forecast, temperatureUnit: unit };
  }
  return {
    ...forecast,
    temperatureUnit: unit,
    current: {
      ...forecast.current,
      temperature: convertCelsiusTemp(forecast.current.temperature, unit),
      feelsLike: convertCelsiusTemp(forecast.current.feelsLike, unit),
    },
    todayHourly: forecast.todayHourly.map((slot) => ({
      ...slot,
      temperature: convertCelsiusTemp(slot.temperature, unit),
    })),
    dayHourly: forecast.dayHourly.map((slot) => ({
      ...slot,
      temperature: convertCelsiusTemp(slot.temperature, unit),
    })),
  };
}
