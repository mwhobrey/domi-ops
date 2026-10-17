import { describe, expect, it } from "vitest";
import { subscriptionAllowsWork } from "./subscription-access.js";
const now = new Date("2026-10-16T12:00:00Z");
const future = new Date("2026-11-16T12:00:00Z");
const base = { status: "active" as const, trialEndsAt: null, currentPeriodEnd: future };
describe("hosted subscription work access", () => {
  it("fails closed without a subscription and after cancellation", () => {
    expect(subscriptionAllowsWork(null, now)).toBe(false);
    expect(subscriptionAllowsWork({ ...base, status: "canceled" }, now)).toBe(false);
  });
  it("preserves paid-through scheduled cancellation and bounds trial access", () => {
    expect(subscriptionAllowsWork(base, now)).toBe(true);
    expect(subscriptionAllowsWork({ ...base, status: "trialing", trialEndsAt: now }, now)).toBe(false);
    expect(subscriptionAllowsWork({ ...base, status: "trialing", trialEndsAt: future }, now)).toBe(true);
  });
  it("bounds payment-failure grace and active paid periods", () => {
    expect(subscriptionAllowsWork({ ...base, status: "past_due", pastDueSince: new Date(now.getTime() - 71 * 3600000) }, now)).toBe(true);
    expect(subscriptionAllowsWork({ ...base, status: "past_due", pastDueSince: new Date(now.getTime() - 72 * 3600000) }, now)).toBe(false);
    expect(subscriptionAllowsWork({ ...base, currentPeriodEnd: now }, now)).toBe(false);
    expect(subscriptionAllowsWork({ ...base, status: "past_due", currentPeriodEnd: null }, now)).toBe(false);
  });
});
