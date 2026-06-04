import type { WeatherPayload } from "./open-meteo.js";

const NWS_USER_AGENT = "whome/1.0 (household app; local dev)";

function nwsHeaders(): Record<string, string> {
  return {
    "User-Agent": NWS_USER_AGENT,
    Accept: "application/geo+json",
  };
}

function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

function parseWindMph(windSpeed: string | undefined): number {
  if (!windSpeed) return 0;
  const m = windSpeed.match(/(\d+)/);
  return m ? Number(m[1]) * 1.60934 : 0;
}

function forecastToWeatherCode(short: string): number {
  const s = short.toLowerCase();
  if (s.includes("thunder")) return 95;
  if (s.includes("snow") || s.includes("sleet")) return 71;
  if (s.includes("rain") || s.includes("shower") || s.includes("drizzle")) return 61;
  if (s.includes("fog")) return 45;
  if (s.includes("cloud") || s.includes("overcast")) return 3;
  if (s.includes("partly")) return 2;
  return 0;
}

type NwsPeriod = {
  startTime: string;
  temperature: number;
  shortForecast: string;
  windSpeed?: string;
  probabilityOfPrecipitation?: { value: number | null };
};

/** US-only fallback when Open-Meteo is unavailable (api.weather.gov). */
export async function fetchNwsForecast(lat: number, lon: number): Promise<WeatherPayload> {
  const pointsRes = await fetch(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    { headers: nwsHeaders(), signal: AbortSignal.timeout(12_000) },
  );
  if (!pointsRes.ok) throw new Error("nws_points_unavailable");

  const points = (await pointsRes.json()) as {
    properties?: { forecastHourly?: string };
  };
  const hourlyUrl = points.properties?.forecastHourly;
  if (!hourlyUrl) throw new Error("nws_hourly_unavailable");

  const hourlyRes = await fetch(hourlyUrl, {
    headers: nwsHeaders(),
    signal: AbortSignal.timeout(12_000),
  });
  if (!hourlyRes.ok) throw new Error("nws_hourly_unavailable");

  const hourly = (await hourlyRes.json()) as {
    properties?: { periods?: NwsPeriod[] };
  };
  const periods = hourly.properties?.periods ?? [];
  if (periods.length === 0) throw new Error("nws_no_periods");

  const now = Date.now();
  const future = periods.filter((p) => new Date(p.startTime).getTime() >= now - 30 * 60_000);
  const slots = (future.length > 0 ? future : periods).slice(0, 8);

  const first = slots[0];
  const tempC = fahrenheitToCelsius(first.temperature);

  const todayHourly = slots.map((p) => ({
    time: p.startTime,
    temperature: fahrenheitToCelsius(p.temperature),
    precipProbability: p.probabilityOfPrecipitation?.value ?? 0,
    weatherCode: forecastToWeatherCode(p.shortForecast),
  }));

  return {
    locationLabel: null,
    timezone: "America/New_York",
    current: {
      temperature: tempC,
      feelsLike: tempC,
      weatherCode: forecastToWeatherCode(first.shortForecast),
      windSpeed: parseWindMph(first.windSpeed),
    },
    todayHourly,
    dayHourly: todayHourly,
  };
}

/** Rough US bounding box (incl. AK/HI margin) for NWS eligibility. */
export function isLikelyUsLocation(lat: number, lon: number): boolean {
  return lat >= 18 && lat <= 72 && lon >= -172 && lon <= -65;
}
