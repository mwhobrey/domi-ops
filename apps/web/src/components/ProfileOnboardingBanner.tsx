"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "./ui";

export function ProfileOnboardingBanner({ name }: { name: string | null }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || (name && name.trim())) return null;
  return (
    <Alert variant="info" className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <span>Set your name on Profile so the household knows who you are.</span>
      <div className="flex gap-2">
        <Link
          href="/profile"
          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
        >
          Go to Profile
        </Link>
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
