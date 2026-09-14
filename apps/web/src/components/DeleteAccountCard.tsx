"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiError } from "../lib/client-api";
import { authClient } from "../lib/auth-client";
import { logOutRevenueCat } from "../lib/revenuecat-client";
import { Alert, Button } from "./ui";

/**
 * App Store / Play account-deletion surface (WHO-291).
 * Requires typing DELETE to confirm.
 */
export function DeleteAccountCard() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (confirm !== "DELETE") {
      setError('Type DELETE in capitals to confirm.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.delete("/api/core/profile/account", { confirm: "DELETE" });
      await logOutRevenueCat().catch(() => undefined);
      await authClient.signOut().catch(() => undefined);
      router.push("/login?reset=account-deleted");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const body = JSON.parse(err.body ?? "{}") as { message?: string; error?: string };
          setError(body.message ?? body.error ?? err.message);
        } catch {
          setError(err.message);
        }
      } else {
        setError("Could not delete account.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/10 p-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-danger)]">Delete account</h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Permanently removes your Domi Ops login and membership. Household data owned only by you
          may become inaccessible. This cannot be undone.
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-label text-[var(--color-text-muted)]">
          Type <span className="font-mono">DELETE</span> to confirm
        </span>
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-danger)]"
        />
      </label>
      {error ? (
        <Alert variant="error" className="text-sm">
          {error}
        </Alert>
      ) : null}
      <Button
        type="button"
        variant="danger"
        disabled={busy || confirm !== "DELETE"}
        loading={busy}
        onClick={() => void onDelete()}
      >
        Delete my account
      </Button>
    </div>
  );
}
