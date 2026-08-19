"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../../components/ui";

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Helsinki",
  "Europe/Warsaw",
  "Europe/Lisbon",
  "Europe/Athens",
  "Europe/Bucharest",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
];

type ValidateResult =
  | { valid: true; householdId: string; email: string; householdName: string }
  | { valid: false; reason: string };

export function HostedSetupForm({
  sessionId,
  initialData,
}: {
  sessionId: string;
  initialData: ValidateResult;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState(
    initialData.valid ? initialData.householdName || initialData.email.split("@")[0] || "" : "",
  );
  const [timezone, setTimezone] = useState("UTC");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!initialData.valid) {
    return (
      <div
        className="rounded-[var(--radius-lg)] border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/20 px-3 py-3 text-sm text-[var(--color-danger)]"
        role="alert"
      >
        <p className="font-medium">This setup link is not valid.</p>
        <p className="mt-1 text-xs opacity-80">
          {initialData.reason === "not_paid"
            ? "Your payment has not been confirmed yet. Please wait a moment and refresh."
            : initialData.reason === "no_household"
              ? "Your account has not been provisioned yet. This can take a moment after checkout — please try again in 30 seconds."
              : "The session ID is missing or invalid. Please return to checkout and try again."}
        </p>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/billing/hosted-setup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          password,
          householdName: householdName.trim(),
          timezone,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(
          data.error === "email_taken"
            ? "An account already exists with this email but is not linked to this household. Please contact support."
            : data.error === "not_paid"
              ? "Payment not confirmed. Please wait and try again."
              : "Setup failed. Please try again.",
        );
        return;
      }
      router.push("/login?hosted=1");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--color-text-muted)]">
        Setting up account for <span className="font-medium text-[var(--color-text)]">{initialData.email}</span>
      </p>

      {error && (
        <p
          className="rounded-[var(--radius-lg)] border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/20 px-3 py-2 text-sm text-[var(--color-danger)]"
          role="alert"
        >
          {error}
        </p>
      )}

      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-[var(--color-text-muted)]">Household name</span>
          <input
            type="text"
            name="householdName"
            autoComplete="organization"
            required
            value={householdName}
            onChange={(e) => setHouseholdName(e.target.value)}
            className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-[var(--color-text-muted)]">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
          <span className="block text-xs text-[var(--color-text-muted)]">Minimum 8 characters</span>
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-[var(--color-text-muted)]">Timezone</span>
          <select
            name="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <Button type="submit" className="w-full" loading={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </div>
  );
}
