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
  const forward = ["content-type", "cookie", "origin", "authorization", "accept", "accept-language"];
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
    console.error(`[whome auth-proxy] ${request.method} ${target}:`, message);
    return NextResponse.json({ error: "auth_proxy_fetch_failed", message }, { status: 502 });
  }

  const responseBody = await upstream.text();

  if (process.env.NODE_ENV === "development" && upstream.status >= 500) {
    console.error(
      `[whome auth-proxy] ${request.method} ${target} → ${upstream.status}`,
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

  return new NextResponse(responseBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
