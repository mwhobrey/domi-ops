import { eq, sql } from "drizzle-orm";
import { households, householdSubscriptions, type Database } from "@domi-ops/db";
import { isHostedDeployment, isModuleEnabled, parseHouseholdModulesJson, subscriptionAllowsWork, type Env } from "@domi-ops/config";
import type { McpIdentity } from "@domi-ops/auth";

export class McpGatewayError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 401 | 403 | 402 | 413 | 429 | 503 | 504 = 403) { super(code); }
}
export const MCP_LIMITS = { defaultPage: 25, maxPage: 50, noteCharacters: 6000, resultBytes: 32768, requestBytes: 65536, deadlineMs: 10000, concurrent: 2, connectionPerMinute: 30, householdPerMinute: 120 } as const;

/** Logical operation policy: transport POST is never evidence of a product write. */
export async function checkOperation(tx: Database, env: Env, identity: McpIdentity, operation: { module?: "core"; access: "read" | "write" }) {
  if (operation.module) {
    const [household] = await tx.select({ modules: households.modulesEnabled }).from(households).where(eq(households.id, identity.householdId));
    if (!household || !isModuleEnabled(env, operation.module) || !parseHouseholdModulesJson(household.modules).includes(operation.module)) throw new McpGatewayError("tool_unavailable");
    if (isHostedDeployment(env)) {
      const [subscription] = await tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, identity.householdId));
      // Subscription status limits writes; current module entitlement still limits reads.
      if (subscription && !parseHouseholdModulesJson(subscription.modulesEntitled).includes(operation.module)) throw new McpGatewayError("tool_unavailable");
    }
  }
  if (operation.access === "write") {
    const [subscription] = isHostedDeployment(env) ? await tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, identity.householdId)) : [];
    if (isHostedDeployment(env) && !subscriptionAllowsWork(subscription ?? null)) throw new McpGatewayError("subscription_read_only", 402);
    throw new McpGatewayError("writes_not_enabled");
  }
  await tx.execute(sql`select set_config('statement_timeout', '1500ms', true)`);
}
