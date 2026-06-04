import Redis from "ioredis";
import type { WeatherPayload } from "./open-meteo.js";

export type CachedWeatherEntry = {
  source: "open-meteo" | "nws";
  payload: WeatherPayload;
  fetchedAt: string;
};

const TTL_SEC = 45 * 60;

let redisClient: Redis | null = null;

function getRedis(redisUrl: string): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
  }
  return redisClient;
}

function cacheKey(lat: number, lon: number, dateKey: string): string {
  return `weather:v1:${lat.toFixed(4)}:${lon.toFixed(4)}:${dateKey}`;
}

export async function getCachedWeather(
  redisUrl: string | undefined,
  lat: number,
  lon: number,
  dateKey: string,
): Promise<CachedWeatherEntry | null> {
  if (!redisUrl) return null;
  try {
    const redis = getRedis(redisUrl);
    if (redis.status !== "ready") await redis.connect();
    const raw = await redis.get(cacheKey(lat, lon, dateKey));
    if (!raw) return null;
    return JSON.parse(raw) as CachedWeatherEntry;
  } catch {
    return null;
  }
}

export async function setCachedWeather(
  redisUrl: string | undefined,
  lat: number,
  lon: number,
  dateKey: string,
  entry: CachedWeatherEntry,
): Promise<void> {
  if (!redisUrl) return;
  try {
    const redis = getRedis(redisUrl);
    if (redis.status !== "ready") await redis.connect();
    await redis.set(cacheKey(lat, lon, dateKey), JSON.stringify(entry), "EX", TTL_SEC);
  } catch {
    /* best-effort */
  }
}
