import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { McpAuthorizationError, MCP_POLICY_VERSION, type McpAuthorization } from "@domi-ops/auth";
import type { Env } from "@domi-ops/config";

const prepare = z.object({
  householdId: z.string().uuid(), oauthQuery: z.string().max(12000), noteIds: z.array(z.string().uuid()).max(100).default([]),
  adultAttested: z.literal(true), privacyAttested: z.literal(true), policyVersion: z.literal(MCP_POLICY_VERSION),
  providerSettingsReviewed: z.boolean().optional().default(false),
}).strict();
const decide = z.object({ pendingId: z.string().uuid(), oauthQuery: z.string().max(12000), accept: z.boolean() }).strict();

/** Intentionally bypasses requireAuth's long-lived tenant transaction. Every action
 * authenticates via McpAuthorization.session()/member() with household scoping;
 * this router additionally enforces deployment/demo, exact Origin and cross-site checks. */
export function mcpAuthorizationRoutes(auth: McpAuthorization, env: Env) {
  const app = new Hono();
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
    if (error instanceof McpAuthorizationError) return c.json({ error: error.code }, error.status);
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
  app.post("/consents/prepare", async (c) => c.json(await auth.prepareConsent(c.req.raw.headers, await body(c.req.raw, prepare))));
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
    await body(c.req.raw, z.object({ scopes: z.array(z.string()).min(1).max(4), noteIds: z.array(z.string().uuid()).max(100) }).strict()))));
  app.post("/household", async (c) => {
    const input = await body(c.req.raw, z.object({ householdId: z.string().uuid(), enabled: z.boolean() }).strict());
    return c.json(await auth.setHouseholdEnabled(c.req.raw.headers, input.householdId, input.enabled));
  });
  return app;
}
