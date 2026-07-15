import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { devCanonicalHostRedirect } from "./lib/canonical-dev-host";

const PUBLIC_PATHS = ["/", "/login", "/setup", "/privacy"];

const MODULE_ROUTE_PREFIXES: { prefix: string; module: string }[] = [
  { prefix: "/school", module: "school" },
  { prefix: "/calendar", module: "calendar_sync" },
  { prefix: "/drive", module: "drive" },
  { prefix: "/health", module: "health" },
];

export async function middleware(request: NextRequest) {
  const canonicalRedirect = devCanonicalHostRedirect(request);
  if (canonicalRedirect) return canonicalRedirect;

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/auth/") || pathname === "/auth") {
    return NextResponse.next();
  }
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
      const data = (await res.json()) as {
        authenticated?: boolean;
        modulesEnabled?: string[];
      };
      if (data.authenticated) {
        const modules = data.modulesEnabled ?? [];
        for (const { prefix, module } of MODULE_ROUTE_PREFIXES) {
          if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
            if (!modules.includes(module)) {
              return NextResponse.redirect(new URL("/dashboard", request.url));
            }
          }
        }
        return NextResponse.next();
      }
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
    "/",
    "/auth/:path*",
    "/login",
    "/setup",
    "/privacy",
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
    "/drive",
    "/drive/:path*",
    "/health",
    "/health/:path*",
    "/expenses",
    "/expenses/:path*",
    "/profile",
    "/profile/:path*",
    "/settings",
    "/settings/:path*",
  ],
};
