import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const apiBase = (process.env.API_URL ?? request.nextUrl.origin).replace(/\/$/, "");
  const sessionUrl = `${apiBase}/auth/session`;

  try {
    const res = await fetch(sessionUrl, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { authenticated?: boolean };
      if (data.authenticated) return NextResponse.next();
    }
  } catch {
    if (process.env.NODE_ENV === "development") return NextResponse.next();
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/calendar",
    "/calendar/:path*",
    "/school",
    "/school/:path*",
    "/shopping",
    "/shopping/:path*",
    "/chores",
    "/chores/:path*",
    "/notes",
    "/notes/:path*",
    "/expenses",
    "/expenses/:path*",
    "/profile",
    "/profile/:path*",
  ],
};
