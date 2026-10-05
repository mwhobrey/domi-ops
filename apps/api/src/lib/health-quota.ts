import type { Database } from "@domi-ops/db";
import { sql } from "drizzle-orm";

/**
 * Limits on how much one household or person can create in the pharmacy, supply and pill organizer
 * features (WHO-417). They exist so one account cannot make the reminder worker or a filling screen do
 * unbounded work; every real use is far below them. A route that would go over answers 409 with the
 * limit's `code`.
 */
export const HEALTH_CAPS = {
  /** Pharmacies in one household's directory (archived ones count: they still cost a row). */
  pharmaciesPerHousehold: { max: 100, code: "too_many_pharmacies" },
  /** Compartments in one organizer plan. The database allows positions 0-15; this is the real limit. */
  compartmentsPerPlan: { max: 8, code: "too_many_compartments" },
  /** Filling sessions kept per person, finished and abandoned ones included. */
  sessionsPerPerson: { max: 60, code: "too_many_sessions" },
  /** Fill appointments generated ahead of today for one plan. */
  occurrencesAhead: { max: 12, code: "too_many_occurrences" },
} as const;

export type HealthCap = { readonly max: number; readonly code: (typeof HEALTH_CAPS)[keyof typeof HEALTH_CAPS]["code"] };

export class CapExceededError extends Error {
  constructor(
    public readonly code: HealthCap["code"],
    public readonly max: number,
  ) {
    super(code);
    this.name = "CapExceededError";
  }
}

/**
 * Serialize "count what exists, then add one" for one key.
 *
 * Under Postgres' default READ COMMITTED isolation two requests can both count 99, both pass a limit
 * of 100, and both insert. A transaction-scoped advisory lock closes that: the second request waits
 * here until the first one's transaction (the whole request, since the tenant middleware wraps each in
 * one) has committed, then counts again and sees 100. Different keys never wait on each other.
 *
 * Call it before the count, in the same transaction as the insert.
 */
export async function lockQuota(db: Database, key: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`health-quota:${key}`}, 0))`);
}

/** Throws {@link CapExceededError} when `current` already fills `cap`, so one more would go over. */
export function assertRoomFor(current: number, cap: HealthCap): void {
  if (current >= cap.max) throw new CapExceededError(cap.code, cap.max);
}
