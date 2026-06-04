"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, LinkButton } from "./ui";

export function ProfileOnboardingBanner({ name }: { name: string | null }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || (name && name.trim())) return null;
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
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </Alert>
  );
}
