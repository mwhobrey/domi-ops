"use client";

import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

/** Must match PUBLIC_APP_URL — Google OAuth callbacks always land there, not on 127.0.0.1 aliases. */
function authBaseUrl(): string {
  const canonical = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  if (typeof window !== "undefined") {
    try {
      return new URL(canonical).origin;
    } catch {
      return window.location.origin;
    }
  }
  return canonical;
}

export const authClient = createAuthClient({
  baseURL: authBaseUrl(),
  basePath: "/auth",
  plugins: [usernameClient()],
});
