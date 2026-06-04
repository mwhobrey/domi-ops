"use client";

import { useCallback, useState } from "react";
import { apiClient, ApiError } from "../lib/client-api";
import { Alert, Checkbox } from "./ui";

export function CalendarReminderPushSettings({
  initialEnabled,
  pushAvailable,
}: {
  initialEnabled: boolean;
  pushAvailable: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const persist = useCallback(async (next: boolean) => {
    await apiClient.patch("/api/core/profile", { pushCalendarRemindersEnabled: next });
    setEnabled(next);
  }, []);

  async function onToggle(checked: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await persist(checked);
      setMsg(checked ? "Calendar reminder push enabled." : "Calendar reminder push disabled.");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not update preference");
      setEnabled(!checked);
    } finally {
      setBusy(false);
    }
  }

  if (!pushAvailable) return null;

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Calendar reminders</legend>
      <Checkbox
        label="Send push notifications before upcoming calendar events"
        checked={enabled}
        disabled={busy}
        onChange={(e) => void onToggle(e.target.checked)}
      />
      <p className="text-xs text-[var(--color-text-muted)]">
        Requires notice push enabled and this browser subscribed on Profile.
      </p>
      {msg && (
        <Alert variant="success" className="text-sm">
          {msg}
        </Alert>
      )}
    </fieldset>
  );
}
