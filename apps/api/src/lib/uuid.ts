const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a UUID string. Request bodies and paths should be checked with this before they reach a
 * query: Postgres rejects a malformed UUID with `invalid_text_representation` (22P02), which would
 * otherwise surface as a 500 instead of a 400/404.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** True for an array whose every element is a UUID string (an empty array is fine). */
export function isUuidList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isUuid);
}
