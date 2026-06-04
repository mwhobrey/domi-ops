"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "./client-api";
import { loadWeatherLocation, type SavedWeatherLocation } from "./weather-location";
import { weatherErrorMessage, type WeatherErrorCode } from "./weather-messages";

export type HourlySlot = {
  time: string;
  temperature: number;
  precipProbability: number;
  weatherCode: number;
};

export type WeatherForecastState = {
  loading: boolean;
  error: string | null;
  needsLocation: boolean;
  location: SavedWeatherLocation | null;
  locationLabel: string | null;
  source: "open-meteo" | "nws" | null;
  cached: boolean;
  temperatureUnit: "fahrenheit" | "celsius";
  current: {
    temperature: number;
    feelsLike: number;
    weatherCode: number;
    windSpeed: number;
  } | null;
  todayHourly: HourlySlot[];
  dayHourly: HourlySlot[];
};

const empty: WeatherForecastState = {
  loading: false,
  error: null,
  needsLocation: false,
  location: null,
  locationLabel: null,
  source: null,
  cached: false,
  temperatureUnit: "fahrenheit",
  current: null,
  todayHourly: [],
  dayHourly: [],
};

export function useWeatherForecast(dateISO?: string | null, enabled = true) {
  const [state, setState] = useState<WeatherForecastState>({ ...empty, loading: enabled });

  const load = useCallback(async () => {
    const loc = loadWeatherLocation();
    if (!loc) {
      setState({ ...empty, needsLocation: true });
      return;
    }

    setState((s) => ({ ...s, loading: true, error: null, needsLocation: false, location: loc }));

    try {
      const params = new URLSearchParams({
        lat: String(loc.lat),
        lon: String(loc.lon),
        label: loc.label,
      });
      if (dateISO) params.set("date", dateISO);

      const res = await apiClient.get<{
        ok: boolean;
        error?: WeatherErrorCode;
        needsLocation?: boolean;
        source?: "open-meteo" | "nws";
        cached?: boolean;
        temperatureUnit?: "fahrenheit" | "celsius";
        locationLabel?: string | null;
        current?: WeatherForecastState["current"];
        todayHourly?: HourlySlot[];
        dayHourly?: HourlySlot[];
      }>(`/api/core/weather?${params}`);

      if (res.needsLocation || res.error === "needsLocation") {
        setState({ ...empty, needsLocation: true, location: loc });
        return;
      }

      if (!res.ok || !res.current) {
        setState({
          ...empty,
          location: loc,
          error: weatherErrorMessage(res.error),
        });
        return;
      }

      setState({
        loading: false,
        error: null,
        needsLocation: false,
        location: loc,
        locationLabel: res.locationLabel ?? loc.label,
        source: res.source ?? "open-meteo",
        cached: res.cached ?? false,
        temperatureUnit: res.temperatureUnit ?? "fahrenheit",
        current: res.current,
        todayHourly: res.todayHourly ?? [],
        dayHourly: res.dayHourly ?? res.todayHourly ?? [],
      });
    } catch {
      setState({
        ...empty,
        location: loc,
        error: "Could not reach the weather service. Try again shortly.",
      });
    }
  }, [dateISO]);

  useEffect(() => {
    if (!enabled) {
      setState({ ...empty });
      return;
    }
    void load();
  }, [enabled, load]);

  return { ...state, reload: load };
}
