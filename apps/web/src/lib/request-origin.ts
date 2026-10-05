/**
 * The origin a request was made to ("https://app.domi-ops.com"), read from the headers a reverse
 * proxy sets. Link-unfurl tags need an absolute URL, and the published image is the same for every
 * deployment, so the origin has to come from the request: `PUBLIC_APP_URL` is inlined at build time
 * (see `env` in next.config.ts) and would put the build machine's fallback into every card.
 *
 * Returns null when there is no usable host, so the caller can leave the tags relative instead of
 * guessing.
 */
const HOST = /^(\[[0-9a-f:]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:\d{1,5})?$/i;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function validHost(host: string): boolean {
  if (!host || !HOST.test(host)) return false;
  const port = host.match(/:(\d+)$/)?.[1];
  return !port || Number(port) <= 65535;
}

const first = (value: string | null): string => (value ?? "").split(",")[0]!.trim();

export function originFromHeaders(get: (name: string) => string | null): string | null {
  // The proxy's host first, then the Host header; a malformed one is skipped, not trusted.
  const host = [first(get("x-forwarded-host")), first(get("host"))].find(validHost);
  if (!host) return null;
  const forwarded = first(get("x-forwarded-proto")).toLowerCase();
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : LOCAL.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}
