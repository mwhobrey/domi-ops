"use client";

import { useCallback, useState } from "react";
import { apiClient, ApiError } from "../lib/client-api";
import { ensurePushSubscribedWhenEnabling } from "../lib/web-push";
import { Alert, Checkbox } from "./ui";

export function ChoreReminderPushSettings({
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
    await apiClient.patch("/api/core/profile", { pushChoresRemindersEnabled: next });
    setEnabled(next);
  }, []);

  async function onToggle(checked: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await persist(checked);
      if (checked) await ensurePushSubscribedWhenEnabling();
      setMsg(checked ? "Chore reminder push enabled." : "Chore reminder push disabled.");
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
      <legend className="text-sm font-medium">Chore reminders</legend>
      <Checkbox
        label="Send push when chores are due today or overdue"
        checked={enabled}
        disabled={busy}
        onChange={(e) => void onToggle(e.target.checked)}
      />
      <p className="text-xs text-[var(--color-text-muted)]">
        Assigned chores notify the assignee only; unassigned chores notify the household.
        Requires Web Push on this device.
      </p>
      {msg && (
        <Alert variant="success" className="text-sm">
          {msg}
        </Alert>
      )}
    </fieldset>
  );
}
