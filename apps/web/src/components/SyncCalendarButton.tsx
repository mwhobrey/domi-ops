"use client";

import { useState } from "react";

export function SyncCalendarButton() {
  const [status, setStatus] = useState<string | null>(null);

  return (
    <button
      type="button"
      className="rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-elevated)]"
      onClick={async () => {
        setStatus("Syncing…");
        try {
          const res = await fetch("/api/calendar/sync", {
            method: "POST",
            credentials: "include",
          });
          if (!res.ok) throw new Error(await res.text());
          setStatus("Sync queued");
        } catch (e) {
          setStatus(e instanceof Error ? e.message : "Failed");
        }
      }}
    >
      Sync now {status ? `(${status})` : ""}
    </button>
  );
}
