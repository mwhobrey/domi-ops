import type { HourlySlot } from "./use-weather-forecast";

/** Match event start time (HH:mm or HH:mm:ss) to nearest hourly forecast within ±1 hour. */
export function matchSlotForEvent(
  startTime: string | null,
  hourly: HourlySlot[],
): HourlySlot | null {
  if (!startTime || hourly.length === 0) return null;

  const parts = startTime.split(":");
  const eventHour = parseInt(parts[0] ?? "", 10);
  if (!Number.isFinite(eventHour)) return null;

  let best: { slot: HourlySlot; delta: number } | null = null;

  for (const slot of hourly) {
    const slotHour = parseInt(slot.time.slice(11, 13), 10);
    if (!Number.isFinite(slotHour)) continue;
    const delta = Math.abs(slotHour - eventHour);
    if (delta > 1) continue;
    if (!best || delta < best.delta) {
      best = { slot, delta };
    }
  }

  return best?.slot ?? null;
}

export function dayWeatherSummary(hourly: HourlySlot[]): {
  weatherCode: number;
  tempMin: number;
  tempMax: number;
} | null {
  if (hourly.length === 0) return null;
  const temps = hourly.map((s) => s.temperature);
  const mid = hourly[Math.floor(hourly.length / 2)];
  return {
    weatherCode: mid.weatherCode,
    tempMin: Math.min(...temps),
    tempMax: Math.max(...temps),
  };
}
