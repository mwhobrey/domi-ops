"use client";

import { CloudSun, MapPin, Navigation } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../lib/client-api";
import { tempUnitSuffix } from "../lib/home-status";
import {
  clearWeatherLocation,
  loadWeatherLocation,
  saveWeatherLocation,
  type SavedWeatherLocation,
} from "../lib/weather-location";
import { useWeatherForecast } from "../lib/use-weather-forecast";
import { weatherIcon, weatherLabel } from "../lib/weather-codes";

type GeocodeHit = { id: number; label: string; latitude: number; longitude: number };
import { Alert, Button, Card, CardBody, CardHeader, Input, SectionHeader, Skeleton } from "./ui";

function formatHour(iso: string): string {
  const h = new Date(iso).getHours();
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h > 12 ? `${h - 12}p` : `${h}a`;
}

export function WeatherPanel() {
  const [saved, setSaved] = useState<SavedWeatherLocation | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeHit[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    setSaved(loadWeatherLocation());
  }, []);

  const forecast = useWeatherForecast(null, Boolean(saved));

  useEffect(() => {
    if (!showSearch || searchQ.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiClient.get<{ results: GeocodeHit[] }>(
          `/api/core/weather/geocode?q=${encodeURIComponent(searchQ.trim())}`,
        );
        setSearchResults(res.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ, showSearch]);

  function applyLocation(loc: SavedWeatherLocation) {
    saveWeatherLocation(loc);
    setSaved(loc);
    setShowSearch(false);
    setSearchQ("");
    setSearchResults([]);
    void forecast.reload();
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeoError("Location is not supported in this browser.");
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false);
        applyLocation({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: "My location",
        });
      },
      (err) => {
        setGeoLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError("Location permission denied. Search for your city instead.");
        } else {
          setGeoError("Could not get your location. Try searching by city or ZIP.");
        }
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <SectionHeader
          title="Weather"
          action={
            saved ? (
              <button
                type="button"
                className="text-xs text-[var(--color-accent)] hover:underline"
                onClick={() => {
                  setShowSearch((v) => !v);
                  setGeoError(null);
                }}
              >
                {showSearch ? "Cancel" : "Change"}
              </button>
            ) : undefined
          }
        />
      </CardHeader>
      <CardBody className="space-y-4">
        {(geoError || forecast.error) && (
          <Alert variant="error" className="text-sm">
            {geoError ?? forecast.error}
          </Alert>
        )}

        {showSearch && (
          <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
            <Input
              placeholder="City, state, or ZIP…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              aria-label="Search location"
            />
            {searching && <p className="text-xs text-[var(--color-text-muted)]">Searching…</p>}
            {searchResults.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {searchResults.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--color-border)]/40"
                      onClick={() =>
                        applyLocation({
                          lat: r.latitude,
                          lon: r.longitude,
                          label: r.label,
                        })
                      }
                    >
                      {r.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {searchQ.length >= 2 && !searching && searchResults.length === 0 && (
              <p className="text-xs text-[var(--color-text-muted)]">No matches. Try another search.</p>
            )}
          </div>
        )}

        {!saved && !showSearch ? (
          <div className="space-y-3">
            <div className="flex gap-3 text-sm text-[var(--color-text-muted)]">
              <CloudSun className="h-8 w-8 shrink-0 opacity-50" aria-hidden />
              <p>Uses Open-Meteo (free, no API key). Pick your location once — we remember it on this device.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={geoLoading} onClick={useMyLocation}>
                <Navigation className="h-4 w-4" aria-hidden />
                Use my location
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowSearch(true)}>
                <MapPin className="h-4 w-4" aria-hidden />
                Search city / ZIP
              </Button>
            </div>
          </div>
        ) : forecast.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : forecast.current ? (
          <>
            <p className="text-xs text-[var(--color-text-muted)]">
              {forecast.locationLabel ?? saved?.label}
              {forecast.source === "nws" && " · via National Weather Service"}
              {forecast.cached && " · cached forecast"}
            </p>
            <div className="flex items-center gap-4">
              <span className="text-4xl" aria-hidden>
                {weatherIcon(forecast.current.weatherCode)}
              </span>
              <div>
                <p className="text-3xl font-semibold tabular-nums">
                  {Math.round(forecast.current.temperature)}
                  {tempUnitSuffix(forecast.temperatureUnit)}
                </p>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {weatherLabel(forecast.current.weatherCode)} · feels{" "}
                  {Math.round(forecast.current.feelsLike)}
                  {tempUnitSuffix(forecast.temperatureUnit)}
                </p>
              </div>
            </div>
            {forecast.todayHourly.length > 0 && (
              <div>
                <p className="text-label mb-2 text-[var(--color-text-muted)]">Rest of today</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {forecast.todayHourly.map((slot) => (
                    <div
                      key={slot.time}
                      className="min-w-[3.5rem] shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border)]/60 bg-[var(--color-surface-subtle)] px-2 py-2 text-center text-xs"
                    >
                      <p className="text-[var(--color-text-muted)]">{formatHour(slot.time)}</p>
                      <p className="font-medium tabular-nums">
                        {Math.round(slot.temperature)}
                        {tempUnitSuffix(forecast.temperatureUnit)}
                      </p>
                      {slot.precipProbability > 15 && (
                        <p className="text-[var(--color-accent)]">{slot.precipProbability}%</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {saved && (
              <button
                type="button"
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                onClick={() => {
                  clearWeatherLocation();
                  setSaved(null);
                  setShowSearch(false);
                  void forecast.reload();
                }}
              >
                Clear saved location
              </button>
            )}
          </>
        ) : saved ? (
          <Button size="sm" variant="secondary" onClick={() => void forecast.reload()}>
            Retry forecast
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}
