"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, LinkButton } from "./ui";

const DISMISS_KEY_PREFIX = "domi-ops:profile-onboarding-dismissed:";

function dismissKey(memberId: string) {
  return `${DISMISS_KEY_PREFIX}${memberId}`;
}

function readDismissed(memberId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(dismissKey(memberId)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(memberId: string) {
  try {
    localStorage.setItem(dismissKey(memberId), "1");
  } catch {
    /* ignore */
  }
}

export function ProfileOnboardingBanner({
  name,
  memberId,
}: {
  name: string | null;
  memberId: string;
}) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(readDismissed(memberId));
  }, [memberId]);

  const dismiss = useCallback(() => {
    writeDismissed(memberId);
    setDismissed(true);
  }, [memberId]);

  if (name?.trim() || dismissed) return null;

  return (
    <Alert variant="info" className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <span>Set your name on Profile so the household knows who you are.</span>
      <div className="flex gap-2">
        <LinkButton href="/profile" size="sm">
          Go to Profile
        </LinkButton>
        <button
          type="button"
          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          onClick={dismiss}
        >
          Dismiss
        </button>
      </div>
    </Alert>
  );
}
