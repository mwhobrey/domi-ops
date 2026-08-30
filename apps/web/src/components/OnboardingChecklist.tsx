"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { launchTour, type TourKey } from "../lib/tours";
import { Card, CardBody, CardHeader, Checkbox, IconButton } from "./ui";

/**
 * First-login guided checklist — content spec: docs/ONBOARDING_GUIDE.md.
 * Domi Ops is cross-platform (phone, tablet, desktop, installed PWA), so progress needs to
 * follow the person, not one browser tab. State lives server-side
 * (household_members.onboarding_*, apps/api/src/routes/onboarding.ts) — a first pass used
 * localStorage and didn't hold up under that requirement (a browser-storage quirk on iOS
 * standalone-PWA mode made it drop even on the same device).
 */

type Step = { key: string; label: string; detail: string; href?: string };

const OWNER_STEPS: Step[] = [
  {
    key: "household-basics",
    label: "Confirm household basics",
    detail: "Household name and timezone — wrong timezone silently shifts every calendar reminder.",
    href: "/settings",
  },
  {
    key: "modules",
    label: "Pick your modules",
    detail: "Turn off ones you won't use — keeps navigation simpler for everyone.",
    href: "/settings",
  },
  {
    key: "invite",
    label: "Bring in your household",
    detail: "Invite adults by email/Google, or provision username-only logins for kids.",
    href: "/settings",
  },
  {
    key: "calendar",
    label: "Set up your calendar",
    detail: "Connect Google (import-only is safest to start) or just add events directly.",
    href: "/calendar",
  },
  {
    key: "notifications",
    label: "Turn on notifications",
    detail: "Opt in to the push notices and reminders you actually want.",
    href: "/profile",
  },
  {
    key: "install",
    label: "Install on your phone",
    detail: "Add to Home Screen from your phone's browser — this is what makes push actually arrive.",
  },
];

const MEMBER_STEPS: Step[] = [
  {
    key: "profile",
    label: "Set up your profile",
    detail: "Display name and avatar, so the household can tell whose chore/note/event is whose.",
    href: "/profile",
  },
  {
    key: "notifications",
    label: "Turn on notifications",
    detail: "Nobody gets these by default — opt in to what's relevant to you.",
    href: "/profile",
  },
  {
    key: "install",
    label: "Install on your phone",
    detail: "Add to Home Screen from your phone's browser.",
  },
  {
    key: "explore",
    label: "Go find what you were invited for",
    detail: "Most people only use two or three modules regularly — start there, not everywhere.",
    href: "/dashboard",
  },
];

function isOwnerLike(role: string): boolean {
  return role === "owner" || role === "admin";
}

export type OnboardingState = { stepsDone: string[]; dismissed: boolean };

function persist(next: Partial<OnboardingState>) {
  fetch("/api/core/onboarding", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  }).catch(() => {
    /* best-effort — worst case the checklist re-offers a step next load */
  });
}

const TOUR_KEYS = new Set<TourKey>(["household-basics", "modules", "invite", "calendar", "notifications"]);

export function OnboardingChecklist({
  role,
  initialState,
}: {
  role: string;
  initialState: OnboardingState | null;
}) {
  const [state, setState] = useState<OnboardingState | null>(initialState);
  const router = useRouter();

  if (!state || state.dismissed) return null;

  const steps = isOwnerLike(role) ? OWNER_STEPS : MEMBER_STEPS;
  const doneCount = steps.filter((s) => state.stepsDone.includes(s.key)).length;

  function toggleStep(key: string) {
    if (!state) return;
    const stepsDone = state.stepsDone.includes(key)
      ? state.stepsDone.filter((k) => k !== key)
      : [...state.stepsDone, key];
    setState({ ...state, stepsDone });
    persist({ stepsDone });
  }

  function dismiss() {
    if (!state) return;
    setState({ ...state, dismissed: true });
    persist({ dismissed: true });
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <p className="font-medium">Getting started</p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {doneCount} of {steps.length} done
          </p>
        </div>
        <IconButton label="Dismiss checklist" onClick={dismiss}>
          <X className="h-4 w-4" />
        </IconButton>
      </CardHeader>
      <CardBody className="space-y-3">
        {steps.map((step) => (
          <div key={step.key} className="flex items-start gap-3">
            <Checkbox
              checked={state.stepsDone.includes(step.key)}
              onChange={() => toggleStep(step.key)}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              {TOUR_KEYS.has(step.key as TourKey) ? (
                <button
                  type="button"
                  onClick={() => launchTour(step.key as TourKey, router)}
                  className="text-left text-sm font-medium hover:text-[var(--color-accent)] hover:underline"
                >
                  {step.label}
                </button>
              ) : step.href ? (
                <a
                  href={step.href}
                  className="text-sm font-medium hover:text-[var(--color-accent)] hover:underline"
                >
                  {step.label}
                </a>
              ) : (
                <p className="text-sm font-medium">{step.label}</p>
              )}
              <p className="text-xs text-[var(--color-text-muted)]">{step.detail}</p>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
