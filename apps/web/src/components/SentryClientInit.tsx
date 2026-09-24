"use client";

import { useEffect } from "react";

// The SDK is imported on demand: every page ships this component, and the SDK is tens of KB
// gzipped that nothing needs until a DSN resolves (and never, on installs without one).
type SentryModule = typeof import("@sentry/nextjs");

async function resolveBrowserDsn(hint?: string | null): Promise<string | null> {
  const baked = hint?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || "";
  if (baked) return baked;
  try {
    const res = await fetch("/config/sentry", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { dsn?: string | null };
    return body.dsn?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * One shared load: the layout's init and an error boundary can ask at the same time, and both
 * must await the same DSN lookup. Cleared when no DSN resolves so a later call can retry.
 */
let loading: Promise<SentryModule | null> | null = null;

/** Loads and initializes the SDK once; null when no DSN is configured. */
function loadBrowserSentry(hint?: string | null): Promise<SentryModule | null> {
  loading ??= (async () => {
    const resolved = await resolveBrowserDsn(hint);
    if (!resolved) return null;
    const Sentry = await import("@sentry/nextjs");
    if (!Sentry.getClient()) {
      Sentry.init({
        dsn: resolved,
        environment: process.env.NODE_ENV,
        integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
      });
    }
    return Sentry;
  })().then(
    (Sentry) => {
      if (!Sentry) loading = null;
      return Sentry;
    },
    () => {
      loading = null;
      return null;
    },
  );
  return loading;
}

/**
 * WHO-292 — browser Sentry init.
 * Prefers a server-passed / baked DSN, otherwise loads `/config/sentry` so a single GHCR
 * image picks up runtime `SENTRY_DSN` from the web container env_file.
 */
export function SentryClientInit({ dsn }: { dsn?: string | null }) {
  useEffect(() => {
    void loadBrowserSentry(dsn);
  }, [dsn]);

  return null;
}

/** Shared by error boundaries: reports the error once the SDK is up (no-op without a DSN). */
export async function captureBrowserException(error: unknown): Promise<void> {
  const Sentry = await loadBrowserSentry(null);
  Sentry?.captureException(error);
}
