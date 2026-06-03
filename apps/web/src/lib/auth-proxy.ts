import { NextRequest, NextResponse } from "next/server";

const API_ORIGIN = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

/** Proxy /auth/* to the API so Set-Cookie is issued for the browser origin (e.g. :3001). */
export async function proxyAuthToApi(
  request: NextRequest,
  pathSegments: string[],
): Promise<NextResponse> {
  const path = pathSegments.length ? `/${pathSegments.join("/")}` : "";
  const target = `${API_ORIGIN}/auth${path}${request.nextUrl.search}`;

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (key.toLowerCase() === "host" || key.toLowerCase() === "connection") continue;
    headers.set(key, value);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(target, init);
  const outHeaders = new Headers();

  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "transfer-encoding" || lower === "connection") return;
    outHeaders.append(key, value);
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
