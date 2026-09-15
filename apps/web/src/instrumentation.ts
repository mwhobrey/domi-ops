import * as Sentry from "@sentry/nextjs";

/**
 * WHO-292 — register Sentry for Next server/edge. Client init is in SentryClientInit
 * so the DSN can come from runtime container env (compose env_file), not only build-time
 * NEXT_PUBLIC_* baking.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
