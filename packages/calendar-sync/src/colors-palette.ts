import { googleCalendarFetch } from "./client.js";

/** Fallback when Colors API is unavailable (Google Calendar API v3 event palette). */
export const GOOGLE_EVENT_COLOR_HEX: Record<string, string> = {
  "1": "#a4bdfc",
  "2": "#7ae7bf",
  "3": "#dbadff",
  "4": "#ff887c",
  "5": "#fbd75b",
  "6": "#ffb878",
  "7": "#46d6db",
  "8": "#e1e1e1",
  "9": "#5484ed",
  "10": "#51b749",
  "11": "#dc2127",
};

let cachedPalette: { at: number; event: Record<string, string> } | null = null;
const PALETTE_TTL_MS = 60 * 60 * 1000;

export async function fetchGoogleEventColorPalette(
  accessToken: string,
): Promise<Record<string, string>> {
  if (cachedPalette && Date.now() - cachedPalette.at < PALETTE_TTL_MS) {
    return cachedPalette.event;
  }
  try {
    const resp = (await googleCalendarFetch(accessToken, "/colors")) as {
      event?: Record<string, { background?: string }>;
    };
    const event: Record<string, string> = {};
    for (const [id, def] of Object.entries(resp.event ?? {})) {
      const bg = def?.background?.trim();
      if (bg) event[id] = bg;
    }
    if (Object.keys(event).length > 0) {
      cachedPalette = { at: Date.now(), event };
      return event;
    }
  } catch {
    /* use static fallback */
  }
  return GOOGLE_EVENT_COLOR_HEX;
}

export function googleEventColorHex(
  colorId: string | null | undefined,
  fallback: string,
  palette: Record<string, string> = GOOGLE_EVENT_COLOR_HEX,
): string {
  const cid = (colorId ?? "").trim();
  if (cid && palette[cid]) return palette[cid];
  return fallback;
}
