"use client";

import { Card, CardBody, SectionHeader } from "./ui";

type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

const STATUS_BADGE: Record<SubscriptionStatus, { label: string; className: string }> = {
  trialing: {
    label: "Trial",
    className:
      "bg-[var(--color-warning-muted)]/30 text-[var(--color-warning)] border border-[var(--color-warning-muted)]",
  },
  active: {
    label: "Active",
    className:
      "bg-[var(--color-success-muted)]/30 text-[var(--color-success)] border border-[var(--color-success-muted)]",
  },
  past_due: {
    label: "Past due",
    className:
      "bg-[var(--color-danger-muted)]/30 text-[var(--color-danger)] border border-[var(--color-danger-muted)]",
  },
  canceled: {
    label: "Canceled",
    className:
      "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] border border-[var(--color-border)]",
  },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function SubscriptionPlanCard({
  subscriptionStatus,
  trialEndsAt,
}: {
  subscriptionStatus: SubscriptionStatus | null;
  trialEndsAt: string | null;
}) {
  if (!subscriptionStatus) return null;

  const badge = STATUS_BADGE[subscriptionStatus];

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionHeader title="Subscription" />
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
          >
            {badge.label}
          </span>
        </div>

        {subscriptionStatus === "trialing" && trialEndsAt && (
          <p className="text-sm text-[var(--color-text-muted)]">
            Your free trial ends on{" "}
            <span className="font-medium text-[var(--color-text)]">{formatDate(trialEndsAt)}</span>.
            No action is needed — your subscription will continue automatically.
          </p>
        )}

        {subscriptionStatus === "trialing" && !trialEndsAt && (
          <p className="text-sm text-[var(--color-text-muted)]">
            You are currently on a free trial.
          </p>
        )}

        {subscriptionStatus === "active" && (
          <p className="text-sm text-[var(--color-text-muted)]">
            Your subscription is active. All entitled modules are available to your household.
          </p>
        )}

        {subscriptionStatus === "past_due" && (
          <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/10 p-3">
            <p className="text-sm font-medium text-[var(--color-danger)]">Payment past due</p>
            <p className="text-sm text-[var(--color-text-muted)]">
              Your payment could not be processed. Please update your payment method to avoid
              service interruption.
            </p>
            <a
              href="mailto:support@domi-ops.com"
              className="inline-block text-sm font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
            >
              Contact support
            </a>
          </div>
        )}

        {subscriptionStatus === "canceled" && (
          <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
            <p className="text-sm font-medium text-[var(--color-text-muted)]">
              Subscription canceled
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">
              Your subscription has been canceled. Module access may be restricted.
            </p>
            <a
              href="mailto:support@domi-ops.com"
              className="inline-block text-sm font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
            >
              Contact support to reactivate
            </a>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
