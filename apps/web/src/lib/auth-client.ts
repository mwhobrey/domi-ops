"use client";

import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

/** Same-origin in the browser — avoids localhost vs 127.0.0.1 cross-origin NetworkError. */
function authBaseUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export const authClient = createAuthClient({
  baseURL: authBaseUrl(),
  basePath: "/auth",
  plugins: [usernameClient()],
});
