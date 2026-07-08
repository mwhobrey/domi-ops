export type SavedWeatherLocation = {
  lat: number;
  lon: number;
  label: string;
};

const STORAGE_KEY = "domi-ops:weather-location";

export function loadWeatherLocation(): SavedWeatherLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedWeatherLocation;
    if (
      typeof parsed.lat === "number" &&
      typeof parsed.lon === "number" &&
      typeof parsed.label === "string"
    ) {
      return parsed;
    }
  } catch {
    /* */
  }
  return null;
}

export function saveWeatherLocation(loc: SavedWeatherLocation): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
}

export function clearWeatherLocation(): void {
  localStorage.removeItem(STORAGE_KEY);
}
