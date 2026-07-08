import {
  isModuleEnabled,
  isModuleEnabledForHousehold,
  parseHouseholdModulesJson,
  type Env,
} from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { households } from "@domi-ops/db";
import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import type { AppVariables } from "../middleware/auth.js";

export async function getHouseholdModules(
  db: Database,
  householdId: string,
): Promise<string[]> {
  const [row] = await db
    .select({ modulesEnabled: households.modulesEnabled })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1);
  if (!row) return ["core"];
  return parseHouseholdModulesJson(row.modulesEnabled);
}

export async function isHouseholdModuleEnabled(
  db: Database,
  env: Env,
  householdId: string,
  module: string,
): Promise<boolean> {
  const modules = await getHouseholdModules(db, householdId);
  return isModuleEnabledForHousehold(env, modules, module);
}

export function requireHouseholdModule(db: Database, env: Env, module: string) {
  return async (c: Context<{ Variables: AppVariables }>, next: Next) => {
    if (!isModuleEnabled(env, module)) {
      return c.json({ error: "module_disabled" }, 403);
    }
    const auth = c.get("auth");
    if (!auth) return next();
    const enabled = await isHouseholdModuleEnabled(db, env, auth.householdId, module);
    if (!enabled) return c.json({ error: "module_disabled" }, 403);
    return next();
  };
}
