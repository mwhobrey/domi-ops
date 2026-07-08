import type { Context, Next } from "hono";
import { isHostedDeployment, type Env } from "@domi-ops/config";
import { getBaseDb, withHouseholdContext, runWithScopedDb, type Database } from "@domi-ops/db";
import type { AppVariables } from "./auth.js";

/**
 * Wraps authenticated requests in a transaction with `app.current_household_id` set.
 * Route handlers use the scoped db proxy from `index.ts` — no per-handler changes.
 */
export function createTenantMiddleware(scopedDb: Database, env: Env) {
  const baseDb = getBaseDb(scopedDb);

  return async (c: Context<{ Variables: AppVariables }>, next: Next) => {
    const auth = c.get("auth");
    if (!auth?.householdId) {
      if (auth && isHostedDeployment(env)) {
        return c.json({ error: "tenant_context_required" }, 500);
      }
      return next();
    }

    return withHouseholdContext(baseDb, auth.householdId, async (tx) =>
      runWithScopedDb(tx, () => next()),
    );
  };
}
