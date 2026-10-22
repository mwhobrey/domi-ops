import { NextRequest, NextResponse } from "next/server";
import { devCanonicalHostRedirect } from "./canonical-dev-host";

function apiOrigin(): string {
  return (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
}

/** Proxy /auth/* to the API so Set-Cookie is issued for the browser origin (e.g. :3001). */
export async function proxyAuthToApi(
  request: NextRequest,
  pathSegments: string[],
): Promise<NextResponse> {
  const canonicalRedirect = devCanonicalHostRedirect(request);
  if (canonicalRedirect) return canonicalRedirect;

  const path = pathSegments.length ? `/${pathSegments.join("/")}` : "";
  const target = `${apiOrigin()}/auth${path}${request.nextUrl.search}`;

  const headers = new Headers();
  // x-forwarded-for: Caddy sets this to the real client IP on the original request into `web`
  // (see deploy/Caddyfile*.example) - without forwarding it here, the API only ever sees this
  // container's own internal IP, and better-auth's rate limiter falls back to one shared bucket
  // across every client regardless of its own ipAddressHeaders config (WHO-251).
  const forward = [
    "content-type",
    "cookie",
    "origin",
    "authorization",
    "accept",
    "accept-language",
    // Preserve browser fetch metadata for upstream request checks.
    "sec-fetch-mode",
    "sec-fetch-site",
    "sec-fetch-dest",
    "x-forwarded-for",
  ];
  for (const name of forward) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.text();
    if (body) init.body = body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth proxy fetch failed";
    console.error(`[domi-ops auth-proxy] ${request.method} ${target}:`, message);
    return NextResponse.json({ error: "auth_proxy_fetch_failed", message }, { status: 502 });
  }

  const responseBody = await upstream.text();

  if (process.env.NODE_ENV === "development" && upstream.status >= 500) {
    console.error(
      `[domi-ops auth-proxy] ${request.method} ${target} → ${upstream.status}`,
      responseBody.slice(0, 500) || "(empty body)",
    );
  }

  const outHeaders = new Headers();
  const skipHeaders = new Set(["transfer-encoding", "connection", "content-length", "set-cookie"]);
  upstream.headers.forEach((value, key) => {
    if (skipHeaders.has(key.toLowerCase())) return;
    outHeaders.append(key, value);
  });
  // Multiple Set-Cookie values must stay separate — forEach merges them and breaks OAuth state cookies.
  const setCookies =
    typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : [];
  for (const cookie of setCookies) {
    outHeaders.append("set-cookie", cookie);
  }

  // The server-side fetch hop is marked "cors" by Undici. The provider therefore
  // answers navigations with its JSON redirect contract, including social callbacks.
  const navigation = request.headers.get("sec-fetch-mode") === "navigate";
  if (navigation && request.method === "GET" && upstream.ok &&
      (path === "/oauth2/authorize" || path.startsWith("/callback/")) &&
      upstream.headers.get("content-type")?.includes("application/json")) {
    const result = JSON.parse(responseBody) as { redirect?: boolean; url?: unknown };
    if (result.redirect === true && typeof result.url === "string") {
      const target = new URL(result.url, request.url);
      if (target.origin === request.nextUrl.origin && !target.username && !target.password) {
        outHeaders.set("location", target.href);
        outHeaders.set("cache-control", "no-store");
        outHeaders.set("referrer-policy", "no-referrer");
        return new NextResponse(null, { status: 303, headers: outHeaders });
      }
    }
  }

  return new NextResponse(responseBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
