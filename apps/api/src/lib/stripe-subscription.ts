import type Stripe from "stripe";

export function stripeSubscriptionState(sub: Stripe.Subscription, existing?: { status: string; pastDueSince: Date | null }) {
  // Starter has one recurring item. Mixed intervals must not shorten an existing paid period.
  const ends = sub.items.data.map((item) => item.current_period_end).filter(Number.isFinite);
  return {
    status: sub.status === "active" ? "active" as const
      : sub.status === "trialing" ? "trialing" as const
      : sub.status === "past_due" ? "past_due" as const : "canceled" as const,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    currentPeriodEnd: ends.length ? new Date(Math.max(...ends) * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    pastDueSince: sub.status === "past_due" ? (existing?.status === "past_due" ? existing.pastDueSince ?? new Date() : new Date()) : null,
    provider: "stripe" as const,
    sourceUpdatedAt: new Date(),
  };
}
