"use client";

import { useState } from "react";
import { Card, CardBody, SectionHeader } from "./ui";
import { isNativeShell } from "../lib/native-shell";
import {
  isRevenueCatAvailable,
  openNativeSubscriptionManage,
  purchaseStarterPackage,
  restorePurchases,
} from "../lib/revenuecat-client";

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
  const native = isNativeShell();
  const iap = native && isRevenueCatAvailable();
  const [iapMessage, setIapMessage] = useState<string | null>(null);
  const [iapPending, setIapPending] = useState(false);

  if (!subscriptionStatus && !native) return null;

  const badge = subscriptionStatus ? STATUS_BADGE[subscriptionStatus] : null;

  async function onPurchase(plan: "monthly" | "annual") {
    setIapPending(true);
    setIapMessage(null);
    const result = await purchaseStarterPackage(plan);
    setIapPending(false);
    if (result.status === "ok") {
      setIapMessage("Purchase complete. Entitlement updates in a moment.");
      return;
    }
    if (result.status === "cancelled") {
      setIapMessage("Purchase cancelled.");
      return;
    }
    if (result.status === "not_available") {
      setIapMessage("In-app purchases are not configured in this build.");
      return;
    }
    setIapMessage(result.message ?? "Purchase failed.");
  }

  async function onRestore() {
    setIapPending(true);
    setIapMessage(null);
    const result = await restorePurchases();
    setIapPending(false);
    setIapMessage(result.status === "ok" ? "Purchases restored." : result.message ?? "Restore failed.");
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionHeader title="Subscription" />
          {badge && (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          )}
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
            {!native && (
              <a
                href="mailto:support@domi-ops.com"
                className="inline-block text-sm font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                Contact support
              </a>
            )}
            {native && (
              <button
                type="button"
                className="text-sm font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
                onClick={() => openNativeSubscriptionManage()}
              >
                Manage in App Store / Play
              </button>
            )}
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
            {!native && (
              <a
                href="mailto:support@domi-ops.com"
                className="inline-block text-sm font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                Contact support to reactivate
              </a>
            )}
          </div>
        )}

        {/* Stripe stays on web/www — never inside the store binary (ADR 005 / WHO-290). */}
        {native && (
          <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
            <p className="text-sm text-[var(--color-text-muted)]">
              On the mobile app, Starter is purchased through the App Store or Google Play (not
              Stripe).
            </p>
            {iap ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={iapPending}
                  className="min-h-11 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 text-sm font-medium text-[var(--color-accent-fg)] disabled:opacity-55"
                  onClick={() => void onPurchase("monthly")}
                >
                  Subscribe monthly
                </button>
                <button
                  type="button"
                  disabled={iapPending}
                  className="min-h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm font-medium disabled:opacity-55"
                  onClick={() => void onPurchase("annual")}
                >
                  Subscribe annual
                </button>
                <button
                  type="button"
                  disabled={iapPending}
                  className="min-h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm font-medium disabled:opacity-55"
                  onClick={() => void onRestore()}
                >
                  Restore purchases
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm font-medium"
                  onClick={() => openNativeSubscriptionManage()}
                >
                  Manage subscription
                </button>
              </div>
            ) : (
              <p className="text-xs text-[var(--color-text-muted)]">
                RevenueCat keys are not set in this web build — IAP buttons stay hidden until
                NEXT_PUBLIC_REVENUECAT_* is configured.
              </p>
            )}
            {iapMessage && (
              <p className="text-xs text-[var(--color-text-muted)]" role="status">
                {iapMessage}
              </p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
