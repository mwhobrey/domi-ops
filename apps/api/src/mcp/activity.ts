import { randomUUID } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import { mcpAccessEvents, mcpHouseholdSettings, mcpHouseholdWindows, mcpConnectionWindows, mcpRequestLeases, withHouseholdContext, withUserLookupContext, type Database } from "@domi-ops/db";
import type { McpIdentity } from "@domi-ops/auth";
import { MCP_LIMITS } from "./access.js";
import type { McpTool } from "./tools.js";

export function metadataContext<T>(db: Database, identity: McpIdentity, fn: (tx: Database) => Promise<T>) {
  return withUserLookupContext(db, identity.userId, (lookup) => withHouseholdContext(lookup, identity.householdId, async (tx) => {
    await tx.execute(sql`select set_config('statement_timeout', '1500ms', true), set_config('lock_timeout', '1000ms', true)`);
    return fn(tx);
  }));
}

/** Household row lock serializes admission across processes and replicas. */
export async function admit(db: Database, identity: McpIdentity, tool: string) {
  const id = randomUUID();
  return metadataContext(db, identity, async (tx) => {
    await tx.select({ id: mcpHouseholdSettings.householdId }).from(mcpHouseholdSettings).where(eq(mcpHouseholdSettings.householdId, identity.householdId)).for("update");
    const [clock] = await tx.execute<{ now: string; bucket: string }>(sql`select statement_timestamp() as now, date_trunc('minute', statement_timestamp()) as bucket`);
    const now = new Date(clock.now), bucket = new Date(clock.bucket);
    const owned = and(eq(mcpConnectionWindows.connectionId, identity.connectionId), eq(mcpConnectionWindows.bucket, bucket));
    await tx.insert(mcpHouseholdWindows).values({ householdId: identity.householdId, bucket }).onConflictDoNothing();
    await tx.insert(mcpConnectionWindows).values({ householdId: identity.householdId, userId: identity.userId, connectionId: identity.connectionId, bucket }).onConflictDoNothing();
    const [household] = await tx.select().from(mcpHouseholdWindows).where(and(eq(mcpHouseholdWindows.householdId, identity.householdId), eq(mcpHouseholdWindows.bucket, bucket)));
    const [connection] = await tx.select().from(mcpConnectionWindows).where(owned);
    const event = (outcome: string) => tx.insert(mcpAccessEvents).values({ id, requestId: id, householdId: identity.householdId, connectionId: identity.connectionId, actorUserId: identity.userId, tool, outcome });
    if (household.calls >= MCP_LIMITS.householdPerMinute || connection.calls >= MCP_LIMITS.connectionPerMinute) {
      // One attributable throttling event/window, rather than an unbounded denial log.
      if (!connection.throttled) { await event("rate_limited"); await tx.update(mcpConnectionWindows).set({ throttled: true }).where(owned); }
      return { id, allowed: false, retryAfter: 60 };
    }
    await tx.update(mcpHouseholdWindows).set({ calls: household.calls + 1 }).where(and(eq(mcpHouseholdWindows.householdId, identity.householdId), eq(mcpHouseholdWindows.bucket, bucket)));
    await tx.update(mcpConnectionWindows).set({ calls: connection.calls + 1 }).where(owned);
    await tx.delete(mcpRequestLeases).where(and(eq(mcpRequestLeases.connectionId, identity.connectionId), lte(mcpRequestLeases.expiresAt, now)));
    const leases = await tx.select({ id: mcpRequestLeases.id }).from(mcpRequestLeases).where(eq(mcpRequestLeases.connectionId, identity.connectionId));
    if (leases.length >= MCP_LIMITS.concurrent) { await event("concurrency_limited"); return { id, allowed: false, retryAfter: 1 }; }
    await tx.insert(mcpRequestLeases).values({ id, householdId: identity.householdId, userId: identity.userId, connectionId: identity.connectionId, expiresAt: new Date(now.getTime() + 30000) });
    await event("started");
    return { id, allowed: true, retryAfter: 0 };
  });
}

export async function finish(db: Database, identity: McpIdentity, id: string, outcome: string, durationMs: number, byteCount: number) {
  await metadataContext(db, identity, async (tx) => {
    await tx.update(mcpAccessEvents).set({ outcome, durationMs: Math.min(MCP_LIMITS.deadlineMs, Math.max(0, Math.round(durationMs))), byteCount })
      .where(and(eq(mcpAccessEvents.id, id), eq(mcpAccessEvents.connectionId, identity.connectionId), eq(mcpAccessEvents.actorUserId, identity.userId)));
    await tx.delete(mcpRequestLeases).where(and(eq(mcpRequestLeases.id, id), eq(mcpRequestLeases.connectionId, identity.connectionId)));
  });
}

export async function tagTool(db: Database, identity: McpIdentity, id: string, tool: McpTool["name"]) {
  await metadataContext(db, identity, async (tx) => {
    await tx.update(mcpAccessEvents).set({ tool }).where(and(eq(mcpAccessEvents.id, id), eq(mcpAccessEvents.actorUserId, identity.userId)));
  });
}
