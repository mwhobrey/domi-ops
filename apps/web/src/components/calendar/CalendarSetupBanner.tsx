"use client";

import { Calendar, Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { googleCalendarConnectUrl } from "../../lib/auth-links";
import { cn } from "../../lib/cn";
import { Alert, AnchorButton, Button } from "../ui";

const DISMISS_KEY = "whome:calendar-setup-dismissed";

const STEPS = [
  { id: "connect" as const, label: "Connect Google" },
  { id: "import" as const, label: "Import calendars" },
  { id: "ready" as const, label: "View events" },
];

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function CalendarSetupBanner({
  oauthConfigured,
  connected,
  needsImport,
  hasCalendars,
  onImport,
}: {
  oauthConfigured: boolean;
  connected: boolean;
  needsImport: boolean;
  hasCalendars: boolean;
  onImport: () => void;
}) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const complete =
    connected && hasCalendars && !needsImport;

  const activeStep = !connected
    ? "connect"
    : needsImport || !hasCalendars
      ? "import"
      : "ready";

  const dismiss = useCallback(() => {
    writeDismissed();
    setDismissed(true);
  }, []);

  if (!oauthConfigured || dismissed || complete) return null;

  return (
    <Alert variant="info" className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-medium text-[var(--color-text)]">
            <Calendar className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
            Set up your household calendar
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Connect Google, pick which calendars to import, then events appear in month, week, and
            day views.
          </p>
          <ol className="mt-4 flex flex-wrap gap-2 sm:gap-3" aria-label="Setup steps">
            {STEPS.map((step, idx) => {
              const done =
                (step.id === "connect" && connected) ||
                (step.id === "import" && connected && hasCalendars && !needsImport) ||
                (step.id === "ready" && complete);
              const active = step.id === activeStep;
              return (
                <li
                  key={step.id}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
                    done &&
                      "border-[var(--color-success)]/40 bg-[var(--color-success-muted)] text-[var(--color-success)]",
                    active &&
                      !done &&
                      "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-text)]",
                    !done &&
                      !active &&
                      "border-[var(--color-border)] text-[var(--color-text-muted)]",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                      done && "bg-[var(--color-success)] text-white",
                      active && !done && "bg-[var(--color-accent)] text-white",
                      !done && !active && "bg-[var(--color-surface-muted)]",
                    )}
                    aria-hidden
                  >
                    {done ? <Check className="h-3 w-3" strokeWidth={3} /> : idx + 1}
                  </span>
                  {step.label}
                </li>
              );
            })}
          </ol>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!connected ? (
            <AnchorButton href={googleCalendarConnectUrl()} size="sm" variant="primary">
              Connect Google
            </AnchorButton>
          ) : (
            <Button size="sm" variant="primary" type="button" onClick={onImport}>
              {needsImport || !hasCalendars ? "Open import wizard" : "Import more"}
            </Button>
          )}
          <button
            type="button"
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            onClick={dismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    </Alert>
  );
}
