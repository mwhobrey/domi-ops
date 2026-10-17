export type SubscriptionAccessState = {
  status: "trialing" | "active" | "past_due" | "canceled";
  trialEndsAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
  pastDueSince?: Date | string | null;
};

/** Reads/export remain available. Paid-through access and a 72-hour payment grace apply to writes/jobs. */
export function subscriptionAllowsWork(subscription: SubscriptionAccessState | null, now = new Date()): boolean {
  if (!subscription) return false;
  const end = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).getTime() : null;
  if (subscription.status === "canceled") return false;
  if (subscription.status === "trialing") {
    const trialEnd = subscription.trialEndsAt ? new Date(subscription.trialEndsAt).getTime() : end;
    return trialEnd != null && trialEnd > now.getTime();
  }
  if (subscription.status === "past_due") {
    const since = subscription.pastDueSince ? new Date(subscription.pastDueSince).getTime() : null;
    return since != null && since + 72 * 3600000 > now.getTime();
  }
  // Legacy active records need provider reconciliation to acquire a paid-through date.
  return end == null || end > now.getTime();
}
