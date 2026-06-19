"use client";

import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

/**
 * Same-origin /auth/* via Next route handler — omit baseURL so better-auth uses
 * window.location.origin in the browser (GHCR images bake localhost otherwise).
 */
export const authClient = createAuthClient({
  basePath: "/auth",
  plugins: [usernameClient()],
});
