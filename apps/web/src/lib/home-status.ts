export type HomePresence = "Home" | "Away";

export type HomeStatusView = {
  presence: HomePresence;
  statusMessage: string | null;
};

export function formatPresenceLine({ presence, statusMessage }: HomeStatusView): string {
  const msg = statusMessage?.trim();
  if (msg) return `${presence} · ${msg}`;
  return presence;
}

export function tempUnitSuffix(unit: "fahrenheit" | "celsius"): "°F" | "°C" {
  return unit === "fahrenheit" ? "°F" : "°C";
}
