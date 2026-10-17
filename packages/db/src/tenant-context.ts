import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

/** Postgres GUC set via `SET LOCAL` / `set_config(..., true)` per transaction (WHO-196). */
export const TENANT_HOUSEHOLD_SETTING = "app.current_household_id";
export const AUTH_USER_SETTING = "app.current_user_id";
export const SYSTEM_ACCESS_SETTING = "app.system_access";
export const WORKER_SCAN_SETTING = "app.worker_scan";

async function setLocalConfig(tx: Database, key: string, value: string): Promise<void> {
  await tx.execute(sql`select set_config(${key}, ${value}, true)`);
}

/** SET LOCAL survives a released savepoint. Restore the caller's scope on success;
 * transaction/savepoint rollback restores it on failure, including an aborted SQL statement. */
async function withLocalConfig<T>(db: Database, key: string, value: string, fn: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const [previous] = await tx.execute<{ value: string | null }>(sql`select current_setting(${key}, true) as value`);
    await setLocalConfig(tx, key, value);
    const result = await fn(tx);
    await setLocalConfig(tx, key, previous?.value ?? "");
    return result;
  });
}

/**
 * Run `fn` inside a transaction with `app.current_household_id` set (RLS tenant scope).
 * Use for API handlers (via scoped db middleware) and household-scoped worker jobs.
 */
export async function withHouseholdContext<T>(
  db: Database,
  householdId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return withLocalConfig(db, TENANT_HOUSEHOLD_SETTING, householdId, fn);
}

/**
 * Resolve membership by `user_id` before household context exists (auth middleware).
 * Requires `member_auth_lookup` RLS policy on `household_members` (0039).
 */
export async function withUserLookupContext<T>(
  db: Database,
  userId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return withLocalConfig(db, AUTH_USER_SETTING, userId, fn);
}

/**
 * Greenfield bootstrap / CLI — bypass household RLS on scoped tables.
 * Requires `system_bootstrap` policies (0039).
 */
export async function withSystemContext<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return withLocalConfig(db, SYSTEM_ACCESS_SETTING, "true", fn);
}

/**
 * Cross-tenant worker scans (reminder/budget/digest schedulers).
 * Requires `worker_scan` policies (0039). Trusted worker process only.
 */
export async function withWorkerScanContext<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return withLocalConfig(db, WORKER_SCAN_SETTING, "true", fn);
}
