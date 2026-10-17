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
  currentPeriodEnd,
  cancelAtPeriodEnd = false,
  billingProvider,
  isOwner = false,
}: {
  subscriptionStatus: SubscriptionStatus | null;
  trialEndsAt: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  billingProvider?: string | null;
  isOwner?: boolean;
}) {
  const native = isNativeShell();
  const iap = native && isRevenueCatAvailable();
  const storePurchaseAllowed = isOwner && (!billingProvider || subscriptionStatus === "canceled");
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
            {cancelAtPeriodEnd ? " Your trial will not renew." : " Your subscription renews automatically unless canceled."}
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

        {cancelAtPeriodEnd && currentPeriodEnd && (
          <p className="text-sm text-[var(--color-text-muted)]">
            Renewal is canceled. Your paid access continues through {formatDate(currentPeriodEnd)}.
          </p>
        )}

        {!native && billingProvider === "stripe" && isOwner && (
          <form method="post" action="/api/billing/portal">
            <button type="submit" className="min-h-11 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 text-sm font-medium text-[var(--color-accent-fg)]">
              Manage billing
            </button>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">Update your payment method, view invoices, change your plan, or cancel renewal.</p>
          </form>
        )}
        {!native && billingProvider === "stripe" && isOwner && subscriptionStatus === "canceled" && (
          <form method="post" action="/api/billing/checkout" className="space-y-2">
            <label className="block text-sm">Restart your household subscription
              <select name="plan" className="ml-2 rounded border p-2 text-[var(--color-text)] bg-[var(--color-surface)]">
                <option value="monthly">$12 per month</option>
                <option value="annual">$120 per year</option>
              </select>
            </label>
            <button type="submit" className="min-h-11 rounded border px-4 text-sm">Review payment and restart</button>
            <p className="text-xs text-[var(--color-text-muted)]">Returning subscriptions start paid access without a second free trial. Review the total at checkout.</p>
          </form>
        )}
        {!native && billingProvider === "stripe" && !isOwner && (
          <p className="text-sm text-[var(--color-text-muted)]">Your household owner manages billing.</p>
        )}
        {!native && billingProvider === "revenuecat" && (
          <p className="text-sm text-[var(--color-text-muted)]">Manage this subscription in the App Store or Google Play account used to purchase it.</p>
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
              Your subscription has ended. You can still read and export the records your permissions allow.
            </p>
            {!native && (
              <a
                href="mailto:support@domi-ops.com"
                className="inline-block text-sm font-medium text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                Need help restarting? Contact support
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
            {!isOwner ? <p className="text-sm">Only the household owner can manage store purchases.</p> : billingProvider === "stripe" && subscriptionStatus !== "canceled" ? <p className="text-sm">This household has a web subscription. Manage it in a web browser before switching billing providers.</p> : iap ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={iapPending || !storePurchaseAllowed}
                  className="min-h-11 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 text-sm font-medium text-[var(--color-accent-fg)] disabled:opacity-55"
                  onClick={() => void onPurchase("monthly")}
                >
                  Subscribe monthly
                </button>
                <button
                  type="button"
                  disabled={iapPending || !storePurchaseAllowed}
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
                Mobile purchases are unavailable in this build. Contact support for help.
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
