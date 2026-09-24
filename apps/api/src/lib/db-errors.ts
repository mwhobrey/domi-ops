/**
 * Postgres `invalid_text_representation` (22P02): a value the database can't parse as the
 * column's type — in practice a malformed UUID from a path or body. That's bad client input
 * (400), not a server fault (500). Drizzle wraps driver errors, so walk the `cause` chain.
 */
export function isInvalidInputError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    if (typeof e === "object" && (e as { code?: unknown }).code === "22P02") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
