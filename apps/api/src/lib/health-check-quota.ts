import type { Database } from "@domi-ops/db";
import { sql } from "drizzle-orm";

/**
 * Serialize "count what a person has, then add one" for that person and kind of thing.
 *
 * Under Postgres' default READ COMMITTED isolation two requests can both count 99, both pass a
 * limit of 100, and both insert. A transaction-scoped advisory lock closes that: the second request
 * waits here until the first one's transaction (the whole request, since the tenant middleware wraps
 * each in one) has committed, then counts again and sees 100. The lock is on a key made from the kind
 * and the person, so different people, and checks versus groups, never wait on each other.
 *
 * Call it before the count, in the same transaction as the insert.
 */
export async function lockCheckQuota(db: Database, kind: "checks" | "check-groups", memberId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`health-quota:${kind}:${memberId}`}, 0))`);
}
