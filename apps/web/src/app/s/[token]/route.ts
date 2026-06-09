import type { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const apiBase = (process.env.API_URL ?? request.nextUrl.origin).replace(/\/$/, "");
  const target = new URL(`${apiBase}/s/${encodeURIComponent(token)}`);
  const password = request.nextUrl.searchParams.get("password");
  if (password) target.searchParams.set("password", password);

  const upstream = await fetch(target.toString(), {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      "X-Share-Password": request.headers.get("x-share-password") ?? "",
    },
    cache: "no-store",
  });

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const disposition = upstream.headers.get("content-disposition");
  const cacheControl = upstream.headers.get("cache-control");
  if (contentType) headers.set("content-type", contentType);
  if (disposition) headers.set("content-disposition", disposition);
  if (cacheControl) headers.set("cache-control", cacheControl);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
