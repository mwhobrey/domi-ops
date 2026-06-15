"use client";

import { useCallback, useState } from "react";
import { apiClient, ApiError } from "../lib/client-api";
import { ensurePushSubscribedWhenEnabling } from "../lib/web-push";
import { Alert, Checkbox } from "./ui";

export function ExpenseBudgetPushSettings({
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
    await apiClient.patch("/api/core/profile", { pushExpenseBudgetAlertsEnabled: next });
    setEnabled(next);
  }, []);

  async function onToggle(checked: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      await persist(checked);
      if (checked) await ensurePushSubscribedWhenEnabling();
      setMsg(checked ? "Budget alert push enabled." : "Budget alert push disabled.");
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
      <legend className="text-sm font-medium">Expense budgets</legend>
      <Checkbox
        label="Send push when a category nears or exceeds its monthly budget"
        checked={enabled}
        disabled={busy}
        onChange={(e) => void onToggle(e.target.checked)}
      />
      <p className="text-xs text-[var(--color-text-muted)]">
        Alerts at 80% and 100% of target, once per month per category. Requires Web Push on this device.
      </p>
      {msg && (
        <Alert variant="success" className="text-sm">
          {msg}
        </Alert>
      )}
    </fieldset>
  );
}
