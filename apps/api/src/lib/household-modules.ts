import {
  isModuleEnabled,
  isModuleEnabledForHousehold,
  type Env,
} from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import type { Context, Next } from "hono";
import type { AppVariables } from "../middleware/auth.js";
import { getHouseholdModuleContext } from "./household-entitlements.js";

export async function getHouseholdModules(
  db: Database,
  householdId: string,
): Promise<string[]> {
  const { modules } = await getHouseholdModuleContext(db, householdId);
  return modules;
}

export async function isHouseholdModuleEnabled(
  db: Database,
  env: Env,
  householdId: string,
  module: string,
): Promise<boolean> {
  const { modules, modulesEntitled } = await getHouseholdModuleContext(db, householdId);
  return isModuleEnabledForHousehold(env, modules, module, modulesEntitled);
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
