import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const LOOPBACK_ALIASES = new Set(["127.0.0.1", "[::1]"]);

/**
 * Dev-only: Google OAuth callbacks use PUBLIC_APP_URL (usually `localhost`).
 * Cookies set on `127.0.0.1` are invisible on `localhost`, which breaks Better Auth state.
 */
export function devCanonicalHostRedirect(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== "development") return null;

  const current = request.nextUrl;
  if (!LOOPBACK_ALIASES.has(current.hostname)) return null;

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

  if (current.hostname === canonical.hostname) return null;

  const redirect = new URL(request.url);
  redirect.hostname = canonical.hostname;
  redirect.port = canonical.port;
  return NextResponse.redirect(redirect);
}
