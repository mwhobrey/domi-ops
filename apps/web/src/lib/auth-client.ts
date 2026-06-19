"use client";

import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

/** Browser origin — /auth/* is same-origin via Next route handler. Avoids GHCR images baking localhost at build time. */
function authBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}

export const authClient = createAuthClient({
  baseURL: authBaseUrl(),
  basePath: "/auth",
  plugins: [usernameClient()],
});
