"use client";
import { privateTelemetryFields, telemetryRoute } from "@domi-ops/config/diagnostics";

/**
 * Opt-in, anonymized metrics client. Nothing in this file runs unless a caller has
 * already confirmed the household's telemetryOptIn is true (see TelemetryBoot.tsx) —
 * this module has no opinion of its own about consent, it just never calls anything
 * until told to. See docs/TELEMETRY.md, packages/db/src/schema/telemetry.ts.
 */

const ANON_ID_KEY = "domi-ops:telemetry-anon-id";
const QUEUE_FLUSH_INTERVAL_MS = 10_000;
const MAX_QUEUE_SIZE = 20;

type TelemetryKind = "web_vital" | "error" | "usage";

type TelemetryEvent = {
  anonId: string;
  kind: TelemetryKind;
  name: string;
  value?: number;
  path?: string;
  deploymentMode?: string;
  appVersion?: string;
  metadata?: Record<string, string | number | boolean>;
};

let endpoint: string | null = null;
let deploymentMode: string | undefined;
let appVersion: string | undefined;
let queue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let listeners: AbortController | null = null;
let vitalsRegistered = false;

function getAnonId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function flush(useBeacon = false) {
  if (queue.length === 0 || !endpoint) return;
  const events = queue;
  queue = [];
  const body = JSON.stringify({ events });
  if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(`${endpoint}/events`, blob);
    return;
  }
  fetch(`${endpoint}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    /* best-effort — telemetry must never disrupt the app */
  });
}

export function trackEvent(
  kind: TelemetryKind,
  name: string,
  opts?: { value?: number; metadata?: Record<string, string | number | boolean> },
) {
  if (!initialized || !endpoint) return;
  const fields = privateTelemetryFields({ kind, name, path: typeof window !== "undefined" ? window.location.pathname : undefined, ...opts });
  if (!fields) return;
  queue.push({
    anonId: getAnonId(),
    kind,
    name: fields.name,
    value: fields.value ?? undefined,
    path: fields.path ?? undefined,
    deploymentMode,
    appVersion,
    metadata: fields.metadata ?? undefined,
  });
  if (queue.length >= MAX_QUEUE_SIZE) flush();
}

/** Call once, only when the household has opted in. Safe to call multiple times — a
 * second call is a no-op so re-renders don't double-register listeners. */
export function initTelemetry(opts: {
  endpoint: string;
  deploymentMode?: string;
  appVersion?: string;
}) {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  listeners = new AbortController();
  const options = { signal: listeners.signal };
  endpoint = opts.endpoint.replace(/\/$/, "");
  deploymentMode = opts.deploymentMode;
  appVersion = opts.appVersion;

  flushTimer = setInterval(() => flush(), QUEUE_FLUSH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  }, options);
  window.addEventListener("pagehide", () => flush(true), options);

  window.addEventListener("error", () => trackEvent("error", "browser_error"), options);
  window.addEventListener("unhandledrejection", () => trackEvent("error", "unhandled_rejection"), options);

  void import("web-vitals").then(({ onCLS, onINP, onLCP, onFCP, onTTFB }) => {
    if (!initialized || options.signal.aborted || vitalsRegistered) return;
    vitalsRegistered = true;
    const report = (metric: { name: string; value: number; rating: string }) => {
      trackEvent("web_vital", metric.name, {
        value: Math.round(metric.value),
        metadata: { rating: metric.rating },
      });
    };
    // CLS is a small decimal (typically 0–0.5) — the `value` column is an integer, so
    // scale ×1000 on write; divide back by 1000 when reading CLS rows out.
    onCLS((m) => report({ ...m, value: m.value * 1000 }));
    onINP(report);
    onLCP(report);
    onFCP(report);
    onTTFB(report);
  });
}

/** Settings toggle flips off — stop collecting and drop anything still queued. */
export function disableTelemetry() {
  initialized = false;
  endpoint = null;
  queue = [];
  listeners?.abort(); listeners = null;
  try { localStorage.removeItem(ANON_ID_KEY); } catch { /* storage can be disabled */ }
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

/**
 * Always available regardless of the opt-in toggle — submitting a bug report is its
 * own one-time, user-authored consent for that one message.
 */
export function submitBugReport(input: {
  message: string;
  email?: string;
  endpoint: string;
  deploymentMode?: string;
  appVersion?: string;
}): Promise<boolean> {
  return fetch(`${input.endpoint.replace(/\/$/, "")}/bug-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Feedback can include an email; never link it to the optional metrics ID.
      anonId: crypto.randomUUID(),
      message: input.message,
      email: input.email,
      deploymentMode: input.deploymentMode,
      appVersion: input.appVersion,
      path: typeof window !== "undefined" ? telemetryRoute(window.location.pathname) : undefined,
    }),
  })
    .then((res) => res.ok)
    .catch(() => false);
}
