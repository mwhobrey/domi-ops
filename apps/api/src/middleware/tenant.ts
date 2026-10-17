import type { Context, Next } from "hono";
import { isHostedDeployment, type Env } from "@domi-ops/config";
import { getBaseDb, withHouseholdContext, runWithScopedDb, type Database } from "@domi-ops/db";
import type { AppVariables } from "./auth.js";
import { householdTodayIsoDate } from "../lib/household-time.js";
import { withHouseholdDate } from "../lib/household-date-context.js";

/**
 * Wraps authenticated requests in a transaction with `app.current_household_id` set.
 * Route handlers use the scoped db proxy from `index.ts` — no per-handler changes.
 */
export function createTenantMiddleware(scopedDb: Database, env: Env) {
  const baseDb = getBaseDb(scopedDb);

  return async (c: Context<{ Variables: AppVariables }>, next: Next) => {
    // Checkout performs only explicit system/identity lookups and independently
    // committed intents. Holding a tenant connection during provider I/O would
    // both hide intent commits and exhaust the pool under concurrent restarts.
    if (c.req.path === "/api/billing/checkout") return next();
    const auth = c.get("auth");
    if (!auth?.householdId) {
      if (auth && isHostedDeployment(env)) {
        return c.json({ error: "tenant_context_required" }, 500);
      }
      return next();
    }

    return withHouseholdContext(baseDb, auth.householdId, async (tx) => {
      const today = await householdTodayIsoDate(tx, auth.householdId);
      return withHouseholdDate(today, () => runWithScopedDb(tx, () => next()));
    });
  };
}
