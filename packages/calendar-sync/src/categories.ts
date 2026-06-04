import { googleCalendarFetch } from "./client.js";
import { inferSourceCategory } from "./mapper.js";
import {
  GOOGLE_EVENT_COLOR_HEX,
  fetchGoogleEventColorPalette,
  googleEventColorHex,
} from "./colors-palette.js";

export { GOOGLE_EVENT_COLOR_HEX, fetchGoogleEventColorPalette, googleEventColorHex } from "./colors-palette.js";
/** Canonical keys for Google event types / presets (always lowercase). */
export function normalizeCategorySourceKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "_");
}

export function hexColorOrNull(value: string | null | undefined): string | null {
  const hex = (value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex : null;
}

export const EVENT_TYPE_FALLBACK_COLORS: Record<string, string> = {
  default: "#2563eb",
  focustime: "#6366f1",
  outofoffice: "#94a3b8",
  workinglocation: "#0ea5e9",
  birthday: "#ec4899",
  fromgmail: "#f59e0b",
};

export type InferredCategory = {
  key: string;
  label: string;
  color: string;
};

export function inferSourceCategoryLabel(event: Record<string, unknown>): {
  key: string;
  label: string;
} {
  const key = inferSourceCategory(event);
  if (key === "default") return { key, label: "Default" };
  if (key.startsWith("google_color_")) {
    const id = key.replace("google_color_", "");
    return { key, label: `Google Color ${id}` };
  }
  const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  return { key, label: label.trim() || key };
}

export function eventCategoryColor(
  event: Record<string, unknown>,
  fallback = "#2563eb",
  palette: Record<string, string> = GOOGLE_EVENT_COLOR_HEX,
): string {
  const colorId = String(event.colorId ?? "").trim();
  if (colorId) return googleEventColorHex(colorId, fallback, palette);
  const { key } = inferSourceCategoryLabel(event);
  const norm = normalizeCategorySourceKey(key);
  // Regular events without colorId inherit their Google calendar color (passed as fallback).
  if (norm === "default") return fallback;
  return EVENT_TYPE_FALLBACK_COLORS[norm] ?? fallback;
}

function commonCategoryRows(
  fallbackColor: string,
  palette: Record<string, string> = GOOGLE_EVENT_COLOR_HEX,
): InferredCategory[] {
  const rows: InferredCategory[] = [
    { key: "default", label: "Default", color: fallbackColor },
    { key: "focustime", label: "Focus Time", color: EVENT_TYPE_FALLBACK_COLORS.focustime },
    { key: "outofoffice", label: "Out of Office", color: EVENT_TYPE_FALLBACK_COLORS.outofoffice },
    {
      key: "workinglocation",
      label: "Working Location",
      color: EVENT_TYPE_FALLBACK_COLORS.workinglocation,
    },
    { key: "birthday", label: "Birthday", color: EVENT_TYPE_FALLBACK_COLORS.birthday },
    { key: "fromgmail", label: "From Gmail", color: EVENT_TYPE_FALLBACK_COLORS.fromgmail },
  ];
  for (let i = 1; i <= 11; i++) {
    rows.push({
      key: `google_color_${i}`,
      label: `Google Color ${i}`,
      color: googleEventColorHex(String(i), fallbackColor, palette),
    });
  }
  return rows;
}

export async function inferGoogleCategories(
  accessToken: string,
  googleCalendarId: string,
  fallbackColor = "#2563eb",
  limit = 100,
): Promise<InferredCategory[]> {
  const palette = await fetchGoogleEventColorPalette(accessToken);
  const seen = new Map<string, InferredCategory>();
  for (const row of commonCategoryRows(fallbackColor, palette)) {
    seen.set(normalizeCategorySourceKey(row.key), row);
  }
  if (!googleCalendarId) {
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  try {
    const resp = (await googleCalendarFetch(
      accessToken,
      `/calendars/${encodeURIComponent(googleCalendarId)}/events`,
      {
        maxResults: String(Math.max(1, Math.min(limit, 250))),
        singleEvents: "false",
        showDeleted: "false",
      },
    )) as { items?: Record<string, unknown>[] };
    for (const event of resp.items ?? []) {
      const { key, label } = inferSourceCategoryLabel(event);
      const norm = normalizeCategorySourceKey(key);
      if (!norm || seen.has(norm)) continue;
      seen.set(norm, {
        key: norm,
        label,
        color: eventCategoryColor(event, fallbackColor, palette),
      });
    }
  } catch {
    /* fall back to common rows */
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export type CategoryMappingRow = {
  sourceKey: string;
  targetKey: string | null;
  targetLabel: string | null;
  targetColor: string | null;
};

/** Remap category keys from import wizard; never overwrite a color already derived from Google. */
export function applyCategoryMapping(
  fields: { categoryKey: string | null; color: string | null },
  sourceKey: string,
  mappings: Map<string, CategoryMappingRow>,
  laneFallbackColor: string | null,
): void {
  const normSource = normalizeCategorySourceKey(sourceKey);
  const row = mappings.get(normSource);
  if (row?.targetKey) {
    fields.categoryKey = row.targetKey.slice(0, 64);
  } else {
    fields.categoryKey = normSource.slice(0, 64);
  }
  if (fields.color) return;
  const mapped = hexColorOrNull(row?.targetColor ?? null) ?? hexColorOrNull(laneFallbackColor);
  if (mapped) fields.color = mapped;
}
