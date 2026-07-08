import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "@domi-ops/config";

vi.mock("./open-meteo.js", () => ({
  fetchOpenMeteoForecast: vi.fn(),
}));

vi.mock("./nws-weather.js", () => ({
  fetchNwsForecast: vi.fn(),
  isLikelyUsLocation: vi.fn(),
}));

vi.mock("./weather-cache.js", () => ({
  getCachedWeather: vi.fn(),
  setCachedWeather: vi.fn(),
}));

import { fetchOpenMeteoForecast } from "./open-meteo.js";
import { fetchNwsForecast, isLikelyUsLocation } from "./nws-weather.js";
import { getCachedWeather, setCachedWeather } from "./weather-cache.js";
import { fetchWeatherForLocation } from "./weather-fetch.js";

const env = { REDIS_URL: undefined } as Env;

const samplePayload = {
  locationLabel: null,
  timezone: "UTC",
  current: {
    temperature: 10,
    feelsLike: 9,
    weatherCode: 0,
    windSpeed: 5,
  },
  todayHourly: [],
  dayHourly: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCachedWeather).mockResolvedValue(null);
  vi.mocked(setCachedWeather).mockResolvedValue(undefined);
});

describe("fetchWeatherForLocation", () => {
  it("returns open-meteo on success", async () => {
    vi.mocked(fetchOpenMeteoForecast).mockResolvedValue(samplePayload);
    const result = await fetchWeatherForLocation(env, 40, -90, "today");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe("open-meteo");
      expect(result.cached).toBe(false);
    }
  });

  it("returns non-US error when open-meteo fails outside US", async () => {
    vi.mocked(fetchOpenMeteoForecast).mockRejectedValue(new Error("down"));
    vi.mocked(isLikelyUsLocation).mockReturnValue(false);
    const result = await fetchWeatherForLocation(env, 48, 2, "today");
    expect(result).toEqual({ ok: false, error: "location_outside_us_fallback" });
  });

  it("serves stale cache when providers fail", async () => {
    vi.mocked(fetchOpenMeteoForecast).mockRejectedValue(new Error("down"));
    vi.mocked(isLikelyUsLocation).mockReturnValue(true);
    vi.mocked(fetchNwsForecast).mockRejectedValue(new Error("down"));
    vi.mocked(getCachedWeather).mockResolvedValue({
      source: "open-meteo",
      payload: samplePayload,
      fetchedAt: new Date().toISOString(),
    });
    const result = await fetchWeatherForLocation(env, 40, -90, "today");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cached).toBe(true);
  });
});
