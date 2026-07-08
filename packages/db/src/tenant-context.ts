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

/**
 * Run `fn` inside a transaction with `app.current_household_id` set (RLS tenant scope).
 * Use for API handlers (via scoped db middleware) and household-scoped worker jobs.
 */
export async function withHouseholdContext<T>(
  db: Database,
  householdId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setLocalConfig(tx as unknown as Database, TENANT_HOUSEHOLD_SETTING, householdId);
    return fn(tx as unknown as Database);
  });
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
  return db.transaction(async (tx) => {
    await setLocalConfig(tx as unknown as Database, AUTH_USER_SETTING, userId);
    return fn(tx as unknown as Database);
  });
}

/**
 * Greenfield bootstrap / CLI — bypass household RLS on scoped tables.
 * Requires `system_bootstrap` policies (0039).
 */
export async function withSystemContext<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setLocalConfig(tx as unknown as Database, SYSTEM_ACCESS_SETTING, "true");
    return fn(tx as unknown as Database);
  });
}

/**
 * Cross-tenant worker scans (reminder/budget/digest schedulers).
 * Requires `worker_scan` policies (0039). Trusted worker process only.
 */
export async function withWorkerScanContext<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setLocalConfig(tx as unknown as Database, WORKER_SCAN_SETTING, "true");
    return fn(tx as unknown as Database);
  });
}
