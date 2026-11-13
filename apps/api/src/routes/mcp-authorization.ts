import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { McpAuthorizationError, MCP_POLICY_VERSION, type McpAuthorization, type McpOwnedConnection } from "@domi-ops/auth";
import type { Database } from "@domi-ops/db";
import type { Env } from "@domi-ops/config";
import { randomUUID } from "node:crypto";
import { checkOperation, McpGatewayError } from "../mcp/access.js";
import { readTools } from "../mcp/read-tools.js";
import { groupScheduleOutput } from "../mcp/med-group-tools.js";
import { groupSchedule, listOwnGroups, occurrenceReferences, proposedGroups, saveGroupSelections, viewGroupSelections } from "../mcp/med-groups.js";
import { availabilityOutput, availabilityPayload, listOwnCalendars, previewWindow, proposedCalendarIds, saveCalendarSelections, viewCalendarSelections } from "../mcp/calendar-availability.js";

const groupChoice = z.object({
  groupId: z.string().uuid(), canLog: z.boolean(), shareCounts: z.boolean().default(true), alias: z.string().max(80).nullable().optional(),
  excludedMedicationIds: z.array(z.string().uuid()).max(100).default([]),
}).strict();
const calendarChoice = z.array(z.string().uuid()).max(50);
const prepare = z.object({
  householdId: z.string().uuid(), oauthQuery: z.string().max(12000), noteIds: z.array(z.string().uuid()).max(100).default([]),
  adultAttested: z.literal(true), privacyAttested: z.literal(true), policyVersion: z.literal(MCP_POLICY_VERSION),
  providerSettingsReviewed: z.boolean().optional().default(false),
  capabilities: z.array(z.string().max(64)).max(16).optional(),
  medGroups: z.array(groupChoice).max(50).optional(), healthAcknowledged: z.boolean().optional(),
  calendarIds: calendarChoice.optional(),
}).strict();
const decide = z.object({ pendingId: z.string().uuid(), oauthQuery: z.string().max(12000), accept: z.boolean() }).strict();

/** Intentionally bypasses requireAuth's long-lived tenant transaction. Every action
 * authenticates via McpAuthorization.session()/member() with household scoping;
 * this router additionally enforces deployment/demo, exact Origin and cross-site checks. */
/** Reads whose exact tool response a member can inspect before sharing it. Notes are shown by title in their picker. */
const previewTools = { "shopping.read": "list_shopping_items", "chores.read": "list_chores" } as const;

export function mcpAuthorizationRoutes(auth: McpAuthorization, env: Env) {
  const app = new Hono();
  const tools = readTools(env), references = occurrenceReferences(env.SESSION_SECRET);
  app.use("*", bodyLimit({ maxSize: 16384, onError: (c) => c.json({ error: "request_too_large" }, 413) }));
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!env.MCP_ENABLED || env.DEMO_MODE) return c.json({ error: "not_found" }, 404);
    if (c.req.header("origin") !== auth.urls.origin || c.req.header("sec-fetch-site") === "cross-site") return c.json({ error: "invalid_origin" }, 403);
    const length = Number(c.req.header("content-length") ?? 0);
    if (length > 16384) return c.json({ error: "request_too_large" }, 413);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof McpAuthorizationError || error instanceof McpGatewayError) return c.json({ error: error.code }, error.status);
    // Do not send provider errors, queries or credentials to the global logger.
    return c.json({ error: "mcp_authorization_failed" }, 500);
  });
  async function body<T>(request: Request, schema: z.ZodType<T>) {
    const text = await request.text();
    if (Buffer.byteLength(text) > 16384) throw new McpAuthorizationError("request_too_large", 400);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new McpAuthorizationError("invalid_input", 400); }
    const result = schema.safeParse(value);
    if (!result.success) throw new McpAuthorizationError("invalid_input", 400);
    return result.data;
  }
  app.post("/consents/prepare", async (c) => {
    const { medGroups = [], healthAcknowledged, calendarIds = [], ...input } = await body(c.req.raw, prepare);
    // Sharing anything about medication takes its own explicit acknowledgment, on top of the general consent.
    if (medGroups.length && healthAcknowledged !== true) throw new McpAuthorizationError("acknowledgment_required", 400);
    return c.json(await auth.prepareConsent(c.req.raw.headers, input, medGroups.length || calendarIds.length ? async (tx, connection) => {
      if (medGroups.length) await saveGroupSelections(tx, env, connection, medGroups, true);
      // The consent screen is the acknowledgment for calendars chosen on it.
      if (calendarIds.length) await saveCalendarSelections(tx, connection, calendarIds, true);
    } : undefined));
  });
  // Sharing something new needs the household module to be on, as a tool call does. Removing a selection never does.
  const moduleOn = (tx: Database, connection: McpOwnedConnection, module: "health" | "calendar_sync") =>
    checkOperation(tx, env, { ...connection, clientId: "settings", scopes: [] }, { module, access: "read" });
  // The member's own calendars by name, for their browser only. Names never go to a provider.
  app.post("/calendars", async (c) => {
    const input = await body(c.req.raw, z.object({ householdId: z.string().uuid() }).strict());
    return c.json({ calendars: await auth.withMemberSession(c.req.raw.headers, input.householdId, ["calendar:read"], async (tx, member) => {
      await checkOperation(tx, env, { ...member, connectionId: randomUUID(), clientId: "preview", scopes: ["calendar:read"] }, { module: "calendar_sync", access: "read" });
      return listOwnCalendars(tx, member);
    }) });
  });
  // The availability tool's own output for the next seven days, for choices the member has not saved yet.
  app.post("/calendars/preview", async (c) => {
    const input = await body(c.req.raw, z.object({ householdId: z.string().uuid(), calendarIds: calendarChoice }).strict());
    const payload = await auth.withMemberSession(c.req.raw.headers, input.householdId, ["calendar:read"], async (tx, member) => {
      await checkOperation(tx, env, { ...member, connectionId: randomUUID(), clientId: "preview", scopes: ["calendar:read"] }, { module: "calendar_sync", access: "read" });
      const window = await previewWindow(tx, member.householdId);
      return availabilityOutput.parse(await availabilityPayload(tx, member, await proposedCalendarIds(tx, member, input.calendarIds), window.from, window.to));
    });
    return c.json({ tool: "get_calendar_availability", payload });
  });
  app.post("/connections/:id/calendars/view", async (c) => c.json(await auth.withOwnedConnection(c.req.raw.headers, c.req.param("id"), (tx, connection) => viewCalendarSelections(tx, connection))));
  app.post("/connections/:id/calendars", async (c) => {
    const input = await body(c.req.raw, z.object({ calendarIds: calendarChoice, acknowledged: z.boolean().optional() }).strict());
    return c.json(await auth.withOwnedConnection(c.req.raw.headers, c.req.param("id"), async (tx, connection) => {
      if (input.calendarIds.length) await moduleOn(tx, connection, "calendar_sync");
      return saveCalendarSelections(tx, connection, input.calendarIds, input.acknowledged === true);
    }));
  });
  // The member's own groups and medication names, for their browser only. Nothing here goes to a provider.
  app.post("/health-groups", async (c) => {
    const input = await body(c.req.raw, z.object({ householdId: z.string().uuid() }).strict());
    return c.json({ groups: await auth.withMemberSession(c.req.raw.headers, input.householdId, ["health:read"], async (tx, member) => {
      await checkOperation(tx, env, { ...member, connectionId: randomUUID(), clientId: "preview", scopes: ["health:read"] }, { module: "health", access: "read" });
      return listOwnGroups(tx, env, member);
    }) });
  });
  // The schedule tool's own output for choices the member has not saved yet.
  app.post("/health-groups/preview", async (c) => {
    const input = await body(c.req.raw, z.object({ householdId: z.string().uuid(), groups: z.array(groupChoice).max(50) }).strict());
    const payload = await auth.withMemberSession(c.req.raw.headers, input.householdId, ["health:read"], async (tx, member) => {
      const throwaway = randomUUID();
      await checkOperation(tx, env, { ...member, connectionId: throwaway, clientId: "preview", scopes: ["health:read"] }, { module: "health", access: "read" });
      const result = await groupSchedule(tx, member, await proposedGroups(tx, env, member, input.groups), "today", (value) => references.encode(throwaway, value));
      return groupScheduleOutput.parse({ schemaVersion: 1, retrievedAt: new Date().toISOString(), householdTimezone: result.timeZone, date: result.date, coverage: "selected_groups_only", contentTrust: "untrusted", data: result.data });
    });
    return c.json({ tool: "get_medication_group_schedule", payload });
  });
  app.post("/connections/:id/health-groups/view", async (c) => c.json(await auth.withOwnedConnection(c.req.raw.headers, c.req.param("id"), (tx, connection) => viewGroupSelections(tx, env, connection))));
  app.post("/connections/:id/health-groups", async (c) => {
    const input = await body(c.req.raw, z.object({ groups: z.array(groupChoice).max(50), acknowledged: z.boolean().optional() }).strict());
    return c.json(await auth.withOwnedConnection(c.req.raw.headers, c.req.param("id"), async (tx, connection) => {
      if (input.groups.length) await moduleOn(tx, connection, "health");
      return saveGroupSelections(tx, env, connection, input.groups, input.acknowledged === true);
    }));
  });
  app.post("/overview", async (c) => {
    const input = await body(c.req.raw, z.object({ householdId: z.string().uuid() }).strict());
    return c.json(await auth.overview(c.req.raw.headers, input.householdId));
  });
  app.post("/notes", async (c) => {
    const input = await body(c.req.raw, z.object({ householdId: z.string().uuid(), search: z.string().max(100).default("") }).strict());
    return c.json({ notes: await auth.availableNotes(c.req.raw.headers, input.householdId, input.search) });
  });
  app.post("/consents/preview", async (c) => {
    const input = await body(c.req.raw, z.object({ householdId: z.string().uuid(), oauthQuery: z.string().max(12000) }).strict());
    return c.json(await auth.previewConsent(c.req.raw.headers, input.householdId, input.oauthQuery));
  });
  app.post("/consents/reject", async (c) => {
    const input = await body(c.req.raw, z.object({ oauthQuery: z.string().max(12000) }).strict());
    return c.json(await auth.rejectConsent(c.req.raw.headers, input.oauthQuery));
  });
  app.post("/consents/decide", async (c) => c.json(await auth.decideConsent(c.req.raw.headers, await body(c.req.raw, decide))));
  app.post("/connections/:id/revoke", async (c) => c.json(await auth.revokeConnection(c.req.raw.headers, c.req.param("id"))));
  app.post("/connections/:id/narrow", async (c) => c.json(await auth.narrowConnection(c.req.raw.headers, c.req.param("id"),
    await body(c.req.raw, z.object({ scopes: z.array(z.string().max(32)).min(1).max(12), noteIds: z.array(z.string().uuid()).max(100) }).strict()))));
  // The preview is the tool's own output for this member's current data, not a description of it.
  app.post("/capabilities/preview", async (c) => {
    const input = await body(c.req.raw, z.object({ householdId: z.string().uuid(), capability: z.enum(["shopping.read", "chores.read"]) }).strict());
    const tool = tools.find((entry) => entry.name === previewTools[input.capability])!;
    const payload = await auth.withMemberSession(c.req.raw.headers, input.householdId, tool.scopes, async (tx, member) => {
      // No connection exists yet. A throwaway id binds any continuation cursor to nothing usable.
      const identity = { ...member, connectionId: randomUUID(), clientId: "preview", scopes: [...tool.scopes] };
      await checkOperation(tx, env, identity, { module: tool.module, access: "read" });
      return tool.output.parse(await tool.run(tx, identity, tool.input.parse({ limit: 3 }), c.req.raw.signal));
    });
    return c.json({ tool: tool.name, payload });
  });
  app.post("/connections/:id/capabilities", async (c) => c.json(await auth.setCapabilities(c.req.raw.headers, c.req.param("id"),
    await body(c.req.raw, z.object({ capabilities: z.array(z.string().max(64)).max(16), acknowledged: z.boolean().optional() }).strict()))));
  app.post("/household", async (c) => {
    const input = await body(c.req.raw, z.object({ householdId: z.string().uuid(), enabled: z.boolean() }).strict());
    return c.json(await auth.setHouseholdEnabled(c.req.raw.headers, input.householdId, input.enabled));
  });
  return app;
}
