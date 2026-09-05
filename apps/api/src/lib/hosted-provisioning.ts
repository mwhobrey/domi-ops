/**
 * Pure helpers for the hosted checkout → household provisioning path (WHO-285).
 *
 * Stripe mints a fresh customer object for every Checkout Session created without a `customer`,
 * so a person who clicks the plan button more than once (or once per device) shows up as several
 * unrelated customers. `resolveOrProvisionHousehold` in routes/billing.ts uses these to reuse the
 * household they already have instead of spawning a new one each time.
 */

/** Stripe customer ids for the same email, minus the one this checkout is for. */
export function siblingCustomerIds(
  customersWithSameEmail: { id: string }[],
  currentCustomerId: string,
): string[] {
  return customersWithSameEmail
    .map((c) => c.id)
    .filter((id) => id !== currentCustomerId);
}

/**
 * Which already-existing household this checkout should attach to, or null to provision a new one.
 * Precedence, most-specific first:
 *   1. a subscription already linked to this exact Stripe customer,
 *   2. the signed-in user already belongs to a household (repeat checkout),
 *   3. a different Stripe customer for the same email already has a household.
 */
export function pickReusableHousehold(opts: {
  byCurrentCustomer: string | null;
  byOwnerMembership: string | null;
  bySiblingCustomer: string | null;
}): string | null {
  return (
    opts.byCurrentCustomer ??
    opts.byOwnerMembership ??
    opts.bySiblingCustomer ??
    null
  );
}
