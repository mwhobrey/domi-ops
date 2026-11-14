import { and, eq, sql } from "drizzle-orm";
import { households, householdSubscriptions, mcpConnectionCapabilities, type Database } from "@domi-ops/db";
import { isHostedDeployment, isModuleEnabled, mcpDirectActions, parseHouseholdModulesJson, subscriptionAllowsWork, type Env, type McpCapability, type McpModule } from "@domi-ops/config";
import type { McpIdentity } from "@domi-ops/auth";
import type { McpTool } from "./tools.js";

export class McpGatewayError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 401 | 403 | 402 | 413 | 429 | 503 | 504 = 403) { super(code); }
}
/** The per-connection action budget is spent. Carries only how long until it frees up, never what was asked. */
export class McpActionRateLimitError extends McpGatewayError {
  constructor(public readonly retryAfterSeconds: number) { super("rate_limited", 429); }
}
/**
 * The one refusal a client is told the reason for, so it can explain it instead of guessing. The text holds the
 * limit and a wait and nothing from the request. It tells the client not to retry on its own: a retry is a write.
 */
export function actionRateLimitMessage(retryAfterSeconds: number) {
  const wait = Math.min(60, Math.max(1, Math.ceil(retryAfterSeconds) || 60));
  return `rate_limited: Nothing was saved. This connection has reached its limit of ${MCP_LIMITS.actionsPerMinute} actions per minute. Do not retry automatically. Tell the user the action limit was reached and that they can ask again in about ${wait} second${wait === 1 ? "" : "s"}.`;
}
export const MCP_LIMITS = { defaultPage: 25, maxPage: 50, noteCharacters: 6000, resultBytes: 32768, requestBytes: 65536, deadlineMs: 10000, concurrent: 2, connectionPerMinute: 30, householdPerMinute: 120, actionsPerMinute: 10 } as const;

/** Capabilities the member currently has switched on for this connection. Read live, inside the call's transaction. */
export async function enabledCapabilities(tx: Database, identity: McpIdentity): Promise<Set<string>> {
  const rows = await tx.select({ capability: mcpConnectionCapabilities.capability }).from(mcpConnectionCapabilities)
    .where(and(eq(mcpConnectionCapabilities.connectionId, identity.connectionId), eq(mcpConnectionCapabilities.householdId, identity.householdId)));
  return new Set(rows.map((row) => row.capability));
}

type Operation = { module?: McpModule; access: "read" | "write"; capability?: McpCapability; execution?: "transaction" | "direct" };

/** Logical operation policy: transport POST is never evidence of a product write. */
export async function checkOperation(tx: Database, env: Env, identity: McpIdentity, operation: Operation, reviewedWorkflow = false, enabled?: Set<string>) {
  if (operation.module) {
    const [household] = await tx.select({ modules: households.modulesEnabled }).from(households).where(eq(households.id, identity.householdId));
    if (!household || !isModuleEnabled(env, operation.module) || !parseHouseholdModulesJson(household.modules).includes(operation.module)) throw new McpGatewayError("tool_unavailable");
    if (isHostedDeployment(env)) {
      const [subscription] = await tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, identity.householdId));
      // Subscription status limits writes; current module entitlement still limits reads.
      if (subscription && !parseHouseholdModulesJson(subscription.modulesEntitled).includes(operation.module)) throw new McpGatewayError("tool_unavailable");
    }
  }
  // A granted scope is only the outer bound. The member's own switch decides.
  if (operation.capability && !(enabled ?? await enabledCapabilities(tx, identity)).has(operation.capability)) throw new McpGatewayError("tool_unavailable");
  if (operation.access === "write") {
    const [subscription] = isHostedDeployment(env) ? await tx.select().from(householdSubscriptions).where(eq(householdSubscriptions.householdId, identity.householdId)) : [];
    if (isHostedDeployment(env) && !subscriptionAllowsWork(subscription ?? null)) throw new McpGatewayError("subscription_read_only", 402);
    if (operation.execution === "direct") {
      // Direct actions have their own operator ceiling; MCP_WRITES_ENABLED never admits one.
      if (!operation.capability || !mcpDirectActions(env).some((action) => action === operation.capability)) throw new McpGatewayError("writes_not_enabled");
    } else if (!reviewedWorkflow || !env.MCP_WRITES_ENABLED) throw new McpGatewayError("writes_not_enabled");
  }
  await tx.execute(sql`select set_config('statement_timeout', '1500ms', true)`);
}

const unlisted = ["tool_unavailable", "writes_not_enabled", "subscription_read_only"];

export async function permittedTools(tx: Database, env: Env, identity: McpIdentity, registry: readonly McpTool[]) {
  const permitted: McpTool[] = [];
  const enabled = await enabledCapabilities(tx, identity);
  for (const tool of registry) {
    if (!tool.scopes.every((scope) => identity.scopes.includes(scope))) continue;
    try { await checkOperation(tx, env, identity, tool, false, enabled); permitted.push(tool); }
    catch (error) { if (!(error instanceof McpGatewayError && unlisted.includes(error.code))) throw error; }
  }
  return permitted;
}
