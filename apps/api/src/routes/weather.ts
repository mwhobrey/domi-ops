import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { users } from "@domi-ops/db";
import { eq } from "drizzle-orm";
import { formatGeocodeLabel, searchOpenMeteoLocations } from "../lib/open-meteo.js";
import { fetchWeatherForLocation } from "../lib/weather-fetch.js";
import type { WeatherErrorCode } from "../lib/weather-errors.js";
import { applyTemperatureUnit, normalizeTemperatureUnit } from "../lib/weather-units.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

export function weatherRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/weather/geocode", async (c) => {
    const q = c.req.query("q")?.trim() ?? "";
    if (q.length < 2) return c.json({ results: [] });
    try {
      const hits = await searchOpenMeteoLocations(q);
      return c.json({
        results: hits.map((r) => ({
          id: r.id,
          label: formatGeocodeLabel(r),
          latitude: r.latitude,
          longitude: r.longitude,
        })),
      });
    } catch {
      return c.json({ results: [] }, 502);
    }
  });

  app.get("/weather", async (c) => {
    const auth = c.get("auth")!;
    const qLat = c.req.query("lat");
    const qLon = c.req.query("lon");
    let lat = qLat ? Number(qLat) : NaN;
    let lon = qLon ? Number(qLon) : NaN;
    let locationLabel = c.req.query("label")?.trim() || null;
    const dateParam = c.req.query("date")?.trim();
    const dateKey =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : "today";

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      lat = env.WEATHER_LATITUDE ? Number(env.WEATHER_LATITUDE) : NaN;
      lon = env.WEATHER_LONGITUDE ? Number(env.WEATHER_LONGITUDE) : NaN;
      locationLabel = locationLabel ?? env.WEATHER_LOCATION_LABEL ?? null;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return c.json({ ok: false, error: "needsLocation" as WeatherErrorCode });
    }

    const [userRow] = await db
      .select({ temperatureUnit: users.temperatureUnit })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);
    const temperatureUnit = normalizeTemperatureUnit(userRow?.temperatureUnit);

    const result = await fetchWeatherForLocation(env, lat, lon, dateKey);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, 502);
    }

    const converted = applyTemperatureUnit(result.payload, temperatureUnit);
    const hourlyForDate = dateKey === "today" ? converted.todayHourly : converted.dayHourly;

    return c.json(
      {
        ok: true,
        source: result.source,
        cached: result.cached,
        date: dateKey,
        temperatureUnit,
        timezone: converted.timezone,
        locationLabel: locationLabel ?? converted.locationLabel,
        current: converted.current,
        todayHourly: converted.todayHourly,
        dayHourly: hourlyForDate,
      },
      200,
      { "Cache-Control": "public, max-age=600" },
    );
  });

  return app;
}
