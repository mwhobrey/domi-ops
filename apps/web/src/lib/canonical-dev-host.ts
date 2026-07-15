import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const LOOPBACK_ALIASES = new Set(["127.0.0.1", "[::1]"]);

function hostHeaderName(request: NextRequest): string | null {
  const host = request.headers.get("host");
  if (!host) return null;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 0 ? host.slice(0, end + 1) : host;
  }
  return host.split(":")[0] ?? null;
}

/**
 * Loopback alias → PUBLIC_APP_URL host (usually `localhost`).
 * Cookies set on `127.0.0.1` are invisible on `localhost`, which breaks Better Auth OAuth state.
 *
 * Use the `Host` header — Next.js may normalize `request.nextUrl.hostname` to `localhost`
 * while the browser still treats the tab as `127.0.0.1` for cookie scope.
 */
export function devCanonicalHostRedirect(request: NextRequest): NextResponse | null {
  const requestHost = hostHeaderName(request) ?? request.nextUrl.hostname;
  if (!LOOPBACK_ALIASES.has(requestHost)) return null;

  const current = request.nextUrl;
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.PUBLIC_APP_URL ??
    `${current.protocol}//localhost${current.port ? `:${current.port}` : ""}`;

  let canonical: URL;
  try {
    canonical = new URL(configured);
  } catch {
    canonical = new URL(`${current.protocol}//localhost${current.port ? `:${current.port}` : ""}`);
  }

  const sameHost =
    requestHost === canonical.hostname &&
    (current.port || (current.protocol === "https:" ? "443" : "80")) ===
      (canonical.port || (canonical.protocol === "https:" ? "443" : "80"));
  if (sameHost) return null;

  const redirect = new URL(request.url);
  redirect.hostname = canonical.hostname;
  if (canonical.port) redirect.port = canonical.port;
  else redirect.port = "";
  return NextResponse.redirect(redirect);
}
