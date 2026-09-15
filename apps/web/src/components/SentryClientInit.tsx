"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

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
 * WHO-292 — browser Sentry init.
 * Prefers a server-passed / baked DSN, otherwise loads `/config/sentry` so a single GHCR
 * image picks up runtime `SENTRY_DSN` from the web container env_file.
 */
export function SentryClientInit({ dsn }: { dsn?: string | null }) {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (Sentry.getClient()) return;
      const resolved = await resolveBrowserDsn(dsn);
      if (cancelled || !resolved || Sentry.getClient()) return;
      Sentry.init({
        dsn: resolved,
        environment: process.env.NODE_ENV,
        integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [dsn]);

  return null;
}

/** Shared by error boundaries when init may not have run yet. */
export async function ensureBrowserSentry(): Promise<void> {
  if (Sentry.getClient()) return;
  const resolved = await resolveBrowserDsn(null);
  if (!resolved || Sentry.getClient()) return;
  Sentry.init({
    dsn: resolved,
    environment: process.env.NODE_ENV,
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
}
