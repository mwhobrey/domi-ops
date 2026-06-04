export type HourlySlot = {
  time: string;
  temperature: number;
  precipProbability: number;
  weatherCode: number;
};

export type WeatherPayload = {
  locationLabel: string | null;
  timezone: string;
  current: {
    temperature: number;
    feelsLike: number;
    weatherCode: number;
    windSpeed: number;
  } | null;
  todayHourly: HourlySlot[];
  dayHourly: HourlySlot[];
};

function todayKeyInTimezone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nowHourInTimezone(timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  return parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
}

function hourFromSlot(iso: string): number {
  return parseInt(iso.slice(11, 13), 10);
}

function resolveDateKey(dateKey: string, tz: string): string {
  if (dateKey === "today") return todayKeyInTimezone(tz);
  return dateKey;
}

function buildHourlyForDate(
  data: {
    hourly?: {
      time: string[];
      temperature_2m: number[];
      precipitation_probability?: number[];
      weather_code: number[];
    };
  },
  tz: string,
  targetDate: string,
  options: { futureOnlyToday?: boolean },
): HourlySlot[] {
  const slots: HourlySlot[] = [];
  const todayKey = todayKeyInTimezone(tz);
  const nowHour = nowHourInTimezone(tz);
  const isToday = targetDate === todayKey;

  if (!data.hourly?.time) return slots;

  for (let i = 0; i < data.hourly.time.length; i++) {
    const t = data.hourly.time[i];
    if (!t.startsWith(targetDate)) continue;
    const hour = hourFromSlot(t);
    if (options.futureOnlyToday && isToday && hour < nowHour) continue;
    slots.push({
      time: t,
      temperature: data.hourly.temperature_2m[i],
      precipProbability: data.hourly.precipitation_probability?.[i] ?? 0,
      weatherCode: data.hourly.weather_code[i],
    });
  }
  return slots;
}

async function fetchOpenMeteoOnce(url: URL): Promise<Response> {
  return fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
}

export async function fetchOpenMeteoForecast(
  lat: number,
  lon: number,
  dateKey = "today",
): Promise<WeatherPayload> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
  );
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code");
  url.searchParams.set("forecast_days", "16");
  url.searchParams.set("timezone", "auto");

  let res = await fetchOpenMeteoOnce(url);
  if (res.status === 502 || res.status === 503) {
    await new Promise((r) => setTimeout(r, 400));
    res = await fetchOpenMeteoOnce(url);
  }
  if (!res.ok) throw new Error("forecast_unavailable");

  const data = (await res.json()) as {
    timezone?: string;
    current?: {
      temperature_2m: number;
      apparent_temperature: number;
      weather_code: number;
      wind_speed_10m: number;
    };
    hourly?: {
      time: string[];
      temperature_2m: number[];
      precipitation_probability?: number[];
      weather_code: number[];
    };
  };

  const tz = data.timezone ?? "UTC";
  const targetDate = resolveDateKey(dateKey, tz);
  const todayKey = todayKeyInTimezone(tz);

  const dayHourly = buildHourlyForDate(data, tz, targetDate, {});
  const todayHourly = buildHourlyForDate(data, tz, todayKey, { futureOnlyToday: true }).slice(
    0,
    8,
  );

  let current: WeatherPayload["current"] = data.current
    ? {
        temperature: data.current.temperature_2m,
        feelsLike: data.current.apparent_temperature,
        weatherCode: data.current.weather_code,
        windSpeed: data.current.wind_speed_10m,
      }
    : null;

  const anchorSlots = targetDate === todayKey ? todayHourly : dayHourly;

  if (!current && anchorSlots.length > 0) {
    const slot = anchorSlots[0];
    current = {
      temperature: slot.temperature,
      feelsLike: slot.temperature,
      weatherCode: slot.weatherCode,
      windSpeed: 0,
    };
  } else if (!current && dayHourly.length > 0) {
    const slot = dayHourly[0];
    current = {
      temperature: slot.temperature,
      feelsLike: slot.temperature,
      weatherCode: slot.weatherCode,
      windSpeed: 0,
    };
  } else if (!current && data.hourly?.time?.length) {
    const i = data.hourly.time.length - 1;
    current = {
      temperature: data.hourly.temperature_2m[i],
      feelsLike: data.hourly.temperature_2m[i],
      weatherCode: data.hourly.weather_code[i],
      windSpeed: 0,
    };
  }

  if (!current) throw new Error("forecast_unavailable");

  return {
    locationLabel: null,
    timezone: tz,
    current,
    todayHourly,
    dayHourly,
  };
}

export type GeocodeResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
  postcode?: string;
};

export async function searchOpenMeteoLocations(query: string): Promise<GeocodeResult[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];

  const data = (await res.json()) as { results?: GeocodeResult[] };
  return data.results ?? [];
}

export function formatGeocodeLabel(r: GeocodeResult): string {
  const parts = [r.name];
  if (r.admin1) parts.push(r.admin1);
  if (r.postcode) parts.push(r.postcode);
  if (r.country) parts.push(r.country);
  return parts.join(", ");
}
