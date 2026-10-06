import { ApiError } from "../../lib/client-api";
import type { Pharmacy } from "./supply-types";

/**
 * Pure helpers for the pharmacy directory (WHO-421). The API already validates everything it stores;
 * these only decide what is safe to put behind a link and how to say what went wrong.
 */

/** A `tel:` link for the API's dialable form ("5551234567;ext=12"), or null when there is none. */
export function telHref(phoneTel: string | null | undefined): string | null {
  if (!phoneTel) return null;
  // Digits, a leading +, and the ";ext=" suffix the API builds. Anything else is not a dialable number.
  return /^\+?\d{7,15}(;ext=\d{1,6})?$/.test(phoneTel) ? `tel:${phoneTel}` : null;
}

/**
 * The website as a link target, only when it is a plain http(s) address. The API refuses other schemes
 * when saving, but old or hand-edited rows should never be able to put a javascript: link on the page.
 */
export function safeWebsiteHref(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(website);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** A maps search for the address, or null when there is no address to search for. */
export function mapsSearchHref(address: string | null | undefined): string | null {
  const q = address?.trim();
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** "3 current medications", "1 current medication", "No current medications". */
export function medicationCountLabel(count: number): string {
  if (count <= 0) return "No current medications";
  return `${count} current medication${count === 1 ? "" : "s"}`;
}

/** Active pharmacies first, then archived, each by name. Does not change the input. */
export function sortPharmacies(list: readonly Pharmacy[]): Pharmacy[] {
  return [...list].sort(
    (a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null) || a.name.localeCompare(b.name),
  );
}

/** The error code the API answered with (`{ "error": "invalid_website" }`), if there was one. */
export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.body) return null;
  try {
    const parsed = JSON.parse(err.body) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}

const MESSAGES: Record<string, string> = {
  invalid_pharmacy_name: "Enter a name for the pharmacy.",
  invalid_pharmacy_text: "The address or notes are too long.",
  invalid_website: "Enter a website that starts with http:// or https://, like walgreens.com.",
  invalid_phone: "Enter a phone number with 7 to 15 digits, like (555) 123-4567.",
  too_many_pharmacies: "This household has reached the limit of 100 pharmacies. Archived ones count too.",
  forbidden: "You do not have permission to change pharmacies.",
  pharmacy_not_found: "That pharmacy no longer exists. Reload and try again.",
  pharmacy_archived: "That pharmacy is archived. Restore it first, or pick another.",
  version_conflict: "This medication was changed by someone else. Reload and try again.",
  medication_not_found: "That medication no longer exists.",
};

/** A sentence for the person, never a raw code. */
export function pharmacyErrorMessage(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  return (code && MESSAGES[code]) || fallback;
}
