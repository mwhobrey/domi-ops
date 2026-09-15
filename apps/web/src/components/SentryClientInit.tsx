"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * WHO-292 — browser Sentry init from a server-passed DSN.
 * Prefer this over bake-only NEXT_PUBLIC_* so one GHCR image works for whome + hosted
 * when SENTRY_DSN is set on the web container at runtime.
 */
export function SentryClientInit({ dsn }: { dsn: string | null | undefined }) {
  useEffect(() => {
    if (!dsn?.trim()) return;
    if (Sentry.getClient()) return;
    Sentry.init({
      dsn: dsn.trim(),
      environment: process.env.NODE_ENV,
      integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
    });
  }, [dsn]);

  return null;
}
