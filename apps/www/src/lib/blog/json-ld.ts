/** Serialize JSON-LD for a <script> tag without allowing a literal </script> breakout. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
