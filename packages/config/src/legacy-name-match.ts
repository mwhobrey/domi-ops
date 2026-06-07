import { slugLegacyName } from "./imported-stub.js";

function firstToken(value: string): string {
  return value.trim().split(/\s+/)[0] ?? "";
}

/** Whether a login handle (email map name, Google name, username) matches a HomeHub legacy label. */
export function legacyDisplayNameMatches(candidate: string, legacyName: string): boolean {
  const a = candidate.trim().toLowerCase();
  const b = legacyName.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;

  const aFirst = firstToken(a).toLowerCase();
  const bFirst = firstToken(b).toLowerCase();
  if (aFirst && bFirst && aFirst === bFirst) return true;

  if (slugLegacyName(a) === slugLegacyName(b)) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;

  return false;
}

/** Ordered unique legacy-name candidates from email map, profile fields, and username. */
export function collectLegacyNameCandidates(input: {
  email?: string;
  displayName?: string;
  username?: string;
  emailToLegacyName: Map<string, string>;
}): string[] {
  const out: string[] = [];
  const push = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    if (!out.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      out.push(trimmed);
    }
  };

  if (input.email) {
    push(input.emailToLegacyName.get(input.email.toLowerCase()));
  }
  push(input.displayName);
  if (input.displayName) push(firstToken(input.displayName));
  push(input.username);

  return out;
}
