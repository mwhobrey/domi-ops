/**
 * The error code the login page shows (WHO-449). Better Auth appends `error=<code>` to the page it sends a failed sign-in to,
 * so a URL that already carried `error=oauth` can arrive with both, and Next hands a repeated parameter over as an array.
 * Prefer a real code over the generic "oauth" placeholder; otherwise the last value wins.
 */
export function loginErrorCode(value: string | string[] | undefined): string | null {
  const all = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (all.length === 0) return null;
  const specific = all.filter((v) => v !== "oauth");
  return (specific.length > 0 ? specific : all).at(-1)!;
}
