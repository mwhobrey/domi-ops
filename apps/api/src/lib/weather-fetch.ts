import type { Env } from "@whome/config";
import { fetchNwsForecast, isLikelyUsLocation } from "./nws-weather.js";
import { fetchOpenMeteoForecast, type WeatherPayload } from "./open-meteo.js";
import { getCachedWeather, setCachedWeather, type CachedWeatherEntry } from "./weather-cache.js";
import type { WeatherErrorCode } from "./weather-errors.js";

export type WeatherFetchResult =
  | { ok: true; source: "open-meteo" | "nws"; payload: WeatherPayload; cached: boolean }
  | { ok: false; error: WeatherErrorCode };

function redisUrl(env: Env): string | undefined {
  return env.REDIS_URL;
}

function isTodayDateKey(dateKey: string): boolean {
  return dateKey === "today";
}

export async function fetchWeatherForLocation(
  env: Env,
  lat: number,
  lon: number,
  dateKey: string,
): Promise<WeatherFetchResult> {
  const cached = await getCachedWeather(redisUrl(env), lat, lon, dateKey);
  const allowNws = isTodayDateKey(dateKey);

  try {
    const payload = await fetchOpenMeteoForecast(lat, lon, dateKey);
    const entry: CachedWeatherEntry = {
      source: "open-meteo",
      payload,
      fetchedAt: new Date().toISOString(),
    };
    await setCachedWeather(redisUrl(env), lat, lon, dateKey, entry);
    return { ok: true, source: "open-meteo", payload, cached: false };
  } catch {
    if (cached) {
      return {
        ok: true,
        source: cached.source,
        payload: cached.payload,
        cached: true,
      };
    }
    if (!allowNws) {
      return { ok: false, error: "forecast_unavailable" };
    }
    if (!isLikelyUsLocation(lat, lon)) {
      return { ok: false, error: "location_outside_us_fallback" };
    }
    try {
      const payload = await fetchNwsForecast(lat, lon);
      const entry: CachedWeatherEntry = {
        source: "nws",
        payload,
        fetchedAt: new Date().toISOString(),
      };
      await setCachedWeather(redisUrl(env), lat, lon, dateKey, entry);
      return { ok: true, source: "nws", payload, cached: false };
    } catch {
      return { ok: false, error: "forecast_unavailable" };
    }
  }
}
