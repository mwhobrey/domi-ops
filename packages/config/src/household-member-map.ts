/** Parse `Mom:mom@gmail.com,Dad:dad@gmail.com` → email → legacy display name. */
export function parseHouseholdMemberEmailMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw?.trim()) return map;
  for (const part of raw.split(",")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim();
    const email = part.slice(colon + 1).trim().toLowerCase();
    if (name && email) map.set(email, name);
  }
  return map;
}
