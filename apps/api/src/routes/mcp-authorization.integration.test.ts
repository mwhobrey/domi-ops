import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { decodeJwt, decodeProtectedHeader, importJWK, SignJWT } from "jose";
import { symmetricDecrypt } from "better-auth/crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createBetterAuth, MCP_POLICY_VERSION } from "@domi-ops/auth";
import { envSchema, type Env } from "@domi-ops/config";
import {
  createDb, closeDb, households, householdMembers, users, notes, mcpConnections, mcpPendingConsents,
  mcpNoteSelections, noteShares, oauthClient, oauthRefreshToken, jwks, withHouseholdContext, withUserLookupContext,
  withMcpProviderContext, withSystemContext, withWorkerScanContext, type Database,
} from "@domi-ops/db";
import { mcpAuthorizationRoutes } from "./mcp-authorization.js";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { mcpGateway } from "../mcp/gateway.js";
import { admit, finish, metadataContext } from "../mcp/activity.js";
import { contextTool, pageLimit } from "../mcp/tools.js";
import { checkOperation } from "../mcp/access.js";
import { mcpAccessEvents, mcpRequestLeases, mcpConnectionWindows, mcpHouseholdWindows, householdSubscriptions, pruneMcpMetadata } from "@domi-ops/db";
import { shoppingItems, shoppingRecurring, chores, choresRecurring } from "@domi-ops/db";
import { readTools } from "../mcp/read-tools.js";
import { registerMcpAcceptanceCases } from "../mcp/acceptance-cases.js";

const sideEffects = vi.hoisted(() => ({ enqueue: vi.fn(), notify: vi.fn() }));
vi.mock("@domi-ops/calendar-sync", async (original) => ({ ...await original<typeof import("@domi-ops/calendar-sync")>(), enqueueSyncJob: sideEffects.enqueue, deliverUserNotification: sideEffects.notify }));

const url = process.env.MCP_TEST_DATABASE_URL ?? process.env.HOSTED_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const scopes = ["shopping:read", "chores:read", "notes:read", "offline_access"];
type Person = { userId: string; memberId: string; householdId: string; headers: Headers };
type Tokens = { access_token: string; refresh_token: string };

for (const mode of ["single", "shared"] as const) suite(`MCP delegated authorization (${mode}, restricted database role)`, () => {
  let db: Database;
  let auth: ReturnType<typeof createBetterAuth>;
  let server: ReturnType<typeof serve>;
  let origin: string;
  let env: Env;
  let clientId: string;
  let owner: Person;
  let stranger: Person;
  let child: Person;
  let colleague: Person;
  let ownNote: string;
  let foreignNote: string;
  const userIds: string[] = [];
  const householdIds: string[] = [];
  const clientIds: string[] = [];
  const verifier = "v".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callback = "https://assistant.example.test/callback";
  const cookiePrefix = "mcp" + randomUUID().replaceAll("-", "");
  async function post(path: string, body: unknown, person = owner, headers = person.headers) {
    return fetch(origin + path, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual" });
  }
  async function begin(person = owner, requestedScopes = ["shopping:read", "offline_access"], requestedClientId = clientId) {
    const params = new URLSearchParams({ response_type: "code", client_id: requestedClientId, redirect_uri: callback,
      scope: requestedScopes.join(" "), resource: origin + "/api/mcp", state: randomUUID(),
      code_challenge: challenge, code_challenge_method: "S256" });
    const response = await fetch(origin + "/auth/oauth2/authorize?" + params, { headers: person.headers, redirect: "manual" });
    const location = response.headers.get("location") ?? (await response.json() as { url: string }).url;
    expect(new URL(location, origin).pathname).toBe("/ai/consent");
    return new URL(location, origin).searchParams.toString();
  }
  async function prepare(query: string, person = owner, noteIds: string[] = []) {
    const response = await post("/api/mcp-auth/consents/prepare", { householdId: person.householdId, oauthQuery: query, noteIds,
      adultAttested: true, privacyAttested: true, policyVersion: MCP_POLICY_VERSION }, person);
    expect(response.status).toBe(200);
    return await response.json() as { pendingId: string };
  }
  async function decide(query: string, pendingId: string, accept = true, person = owner) {
    return post("/api/mcp-auth/consents/decide", { pendingId, oauthQuery: query, accept }, person);
  }
  async function exchange(code: string, overrides: Record<string, string> = {}) {
    return fetch(origin + "/auth/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: callback,
        code, code_verifier: verifier, resource: origin + "/api/mcp", ...overrides }) });
  }
  async function connect(person = owner, requestedScopes = ["shopping:read", "offline_access"], noteIds: string[] = []) {
    const query = await begin(person, requestedScopes);
    const pending = await prepare(query, person, noteIds);
    const decision = await decide(query, pending.pendingId, true, person);
    expect(decision.status).toBe(200);
    const result = await decision.json() as { redirectUri: string; connectionId: string };
    const code = new URL(result.redirectUri).searchParams.get("code")!;
    expect(code).toBeTruthy();
    const response = await exchange(code);
    expect(response.status).toBe(200);
    return { ...await response.json() as Tokens, connectionId: result.connectionId, code };
  }
  function bearer(token: string) { return new Request(origin + "/api/mcp", { method: "POST", headers: { authorization: "Bearer " + token } }); }
  async function refresh(token: string, extra: Record<string, string> = {}) {
    return fetch(origin + "/auth/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: token, resource: origin + "/api/mcp", ...extra }) });
  }
  async function owned<T>(person: Person, fn: (tx: Database) => Promise<T>) {
    return withUserLookupContext(db, person.userId, (lookup) => withHouseholdContext(lookup, person.householdId, fn));
  }
  async function toolAccess(noteIds: string[] = [], requestedScopes = scopes, person = owner) {
    const token = await connect(person, requestedScopes, noteIds);
    const registry = readTools(env);
    return { token, async run(name: string, args: Record<string, unknown> = {}) {
      const tool = registry.find((entry) => entry.name === name)!;
      return auth.mcp.withGrantContext(bearer(token.access_token), tool.scopes, async (tx, identity) => {
        await checkOperation(tx, env, identity, tool);
        return tool.output.parse(await tool.run(tx, identity, tool.input.parse(args), new AbortController().signal)) as { data: Record<string, unknown>[] | Record<string, unknown>; nextCursor: string | null; truncated: boolean; coverage: string };
      });
    } };
  }
  async function domainSnapshot() {
    return owned(owner, async (tx) => {
      const state: Record<string, unknown> = {};
      for (const table of ["shopping_items", "shopping_recurring", "shopping_trips", "shopping_trip_items", "chores", "chores_recurring", "chore_completions", "chore_member_karma", "notes", "note_shares", "user_notifications", "calendar_sync_outbox", "push_subscriptions"]) {
        const [row] = await tx.execute(sql`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as data from ${sql.identifier(table)} t`);
        state[table] = row.data;
      }
      return state;
    });
  }

  beforeAll(async () => {
    db = createDb(url!);
    const [role] = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(sql`select rolsuper, rolbypassrls from pg_roles where rolname=current_user`);
    expect(role.rolsuper).toBe(false); expect(role.rolbypassrls).toBe(false);
    const app = new Hono();
    const tls = process.env.MCP_TEST_TLS_KEY_FILE && process.env.MCP_TEST_TLS_CERT_FILE ? { createServer: createHttpsServer, serverOptions: { key: readFileSync(process.env.MCP_TEST_TLS_KEY_FILE), cert: readFileSync(process.env.MCP_TEST_TLS_CERT_FILE) } } : {};
    server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0, ...tls });
    await new Promise<void>((resolve) => server.listening ? resolve() : server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected loopback test server");
    origin = (process.env.MCP_TEST_TLS_KEY_FILE ? "https://" : "http://") + "127.0.0.1:" + address.port;
    env = envSchema.parse({ NODE_ENV: "test", DEPLOYMENT_MODE: mode, PUBLIC_APP_URL: origin, API_URL: origin,
      DATABASE_URL: url, SESSION_SECRET: "synthetic-who469-session-secret-for-disposable-fixtures-only", MCP_ENABLED: "true", MCP_SYNTHETIC_DEPLOYMENT: "true", MODULES_ENABLED: "core" });
    auth = createBetterAuth(db, env, { cookiePrefix, deferHouseholdMembership: async () => true });
    app.all("/auth/*", (c) => auth.handler(c.req.raw));
    app.get("/.well-known/oauth-authorization-server/auth", (c) => auth.mcp.metadata(c.req.raw));
    app.route("/api/mcp-auth", mcpAuthorizationRoutes(auth.mcp, env));
    app.route("/", mcpGateway(db, auth.mcp, env));
    for (let i = 0; i < 2; i++) {
      const [h] = await withSystemContext(db, (tx) => tx.insert(households).values({ name: "synthetic-mcp-" + randomUUID(), modulesEnabled: '["core"]' }).returning());
      householdIds.push(h.id);
    }
    const signup = async (householdId: string, role: "owner" | "member" | "child"): Promise<Person> => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      let response: Response;
      try { response = await fetch(origin + "/auth/sign-up/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Synthetic Adult", email: randomUUID() + "@example.test", password: "Synthetic-only-test-password-2026" }) }); }
      finally { warn.mockRestore(); }
      expect(response.status).toBe(200);
      const { user } = await response.json() as { user: { id: string } }; userIds.push(user.id);
      const headers = new Headers({ origin, "content-type": "application/json", cookie: response.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ") });
      const [m] = await withSystemContext(db, (tx) => tx.insert(householdMembers).values({ householdId, userId: user.id, role }).returning());
      return { userId: user.id, memberId: m.id, householdId, headers };
    };
    owner = await signup(householdIds[0], "owner");
    colleague = await signup(householdIds[0], "member");
    stranger = await signup(householdIds[1], "owner");
    child = await signup(householdIds[0], "child");
    await auth.mcp.setHouseholdEnabled(owner.headers, owner.householdId, true);
    await auth.mcp.setHouseholdEnabled(stranger.headers, stranger.householdId, true);
    const client = await auth.mcp.registerClient(owner.headers, { name: "Synthetic fixture", redirectUris: [callback], tokenEndpointAuthMethod: "none", scopes,
      provider: "local", profileVersion: "synthetic-v1", dataMode: "synthetic", enabled: true });
    clientId = client.client_id; clientIds.push(clientId);
    [ownNote] = await owned(owner, async (tx) => (await tx.insert(notes).values({ householdId: owner.householdId, title: "synthetic", content: "synthetic", visibility: "private", createdByUserId: owner.userId }).returning({ id: notes.id })).map((n) => n.id));
    [foreignNote] = await owned(stranger, async (tx) => (await tx.insert(notes).values({ householdId: stranger.householdId, title: "foreign synthetic", content: "synthetic" }).returning({ id: notes.id })).map((n) => n.id));
  }, 30000);
  afterAll(async () => {
    vi.useRealTimers();
    if (db) {
      await withSystemContext(db, async (tx) => { if (householdIds.length) await tx.delete(households).where(inArray(households.id, householdIds)); if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds)); });
      await withMcpProviderContext(db, async (tx) => { if (clientIds.length) await tx.delete(oauthClient).where(inArray(oauthClient.clientId, clientIds)); });
      await closeDb(db);
    }
    await new Promise<void>((resolve, reject) => server ? server.close((error) => error ? reject(error) : resolve()) : resolve());
  });

  it("serves protected-resource discovery and bearer challenges without browser cookie fallback", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
      const response = await fetch(origin + path);
      expect(await response.json()).toEqual({ resource: origin + "/api/mcp", authorization_servers: [origin + "/auth"], bearer_methods_supported: ["header"], scopes_supported: scopes.filter((s) => s !== "offline_access") });
    }
    const response = await post("/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(origin + "/.well-known/oauth-protected-resource/api/mcp");
    expect((await fetch(origin + "/api/mcp")).status).toBe(405);
    const gateway = mcpGateway(db, auth.mcp, env);
    expect((await gateway.request(origin + "/api/mcp", { method: "POST", headers: { host: "attacker.test" } })).status).toBe(403);
    const foreignOrigin = new URL(origin); foreignOrigin.protocol = foreignOrigin.protocol === "https:" ? "http:" : "https:";
    expect((await gateway.request(origin + "/api/mcp", { method: "POST", headers: { host: new URL(origin).host, origin: foreignOrigin.origin } })).status).toBe(403);
    expect((await mcpGateway(db, auth.mcp, { ...env, MCP_ENABLED: false }).request(origin + "/api/mcp", { method: "POST" })).status).toBe(404);
  });
  it("interoperates with the official stateless SDK, validates identity-free input and records metadata only", async () => {
    const token = await connect();
    const client = new Client({ name: "synthetic-sdk", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    const transport = new StreamableHTTPClientTransport(new URL(origin + "/api/mcp"), { requestInit: { headers: { authorization: "Bearer " + token.access_token } } });
    try {
      await client.connect(transport);
      expect(client.getServerCapabilities()?.tools?.listChanged).toBe(false);
      const listed = await client.listTools(); expect(listed.tools.map((t) => t.name)).toEqual(["get_connection_context", "list_shopping_items"]);
      const result = await client.callTool({ name: "get_connection_context", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ capabilities: ["shopping:read"], tools: ["get_connection_context", "list_shopping_items"] });
      const invalid = await client.callTool({ name: "get_connection_context", arguments: { householdId: stranger.householdId } });
      expect(invalid.isError).toBe(true);
      await auth.mcp.revokeConnection(owner.headers, token.connectionId);
      await expect(client.callTool({ name: "get_connection_context", arguments: {} })).rejects.toThrow();
    } finally { await client.close(); }
    const events = await owned(owner, (tx) => tx.select().from(mcpAccessEvents).where(eq(mcpAccessEvents.connectionId, token.connectionId)));
    expect(events.some((e) => e.tool === "get_connection_context" && e.outcome === "succeeded")).toBe(true);
    expect(events.every((e) => e.actorUserId === owner.userId && !JSON.stringify(e).includes(token.access_token) && !JSON.stringify(e).includes("synthetic-sdk"))).toBe(true);
    expect(await owned(stranger, (tx) => tx.select().from(mcpAccessEvents).where(eq(mcpAccessEvents.connectionId, token.connectionId)))).toEqual([]);
    expect(await withWorkerScanContext(db, (tx) => tx.select().from(mcpRequestLeases))).toEqual([]);
  });
  it("bounds inputs and results and filters tools by token scope", async () => {
    const token = await connect();
    const headers = { host: new URL(origin).host, authorization: "Bearer " + token.access_token, accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-protocol-version": "2026-07-28" };
    const gateway = mcpGateway(db, auth.mcp, env, [contextTool, { ...contextTool, name: "list_selected_notes", scopes: ["notes:read"] }]);
    const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "synthetic", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
    const list = await gateway.request(origin + "/api/mcp", { method: "POST", headers: { ...headers, "mcp-method": "tools/list" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta } }) });
    const listed = await list.json() as { result?: { tools: { name: string }[] } };
    expect(listed, JSON.stringify(listed)).toHaveProperty("result.tools");
    expect(listed.result!.tools.map((t) => t.name)).toEqual(["get_connection_context"]);
    expect((await gateway.request(origin + "/api/mcp", { method: "POST", headers, body: JSON.stringify({ data: "x".repeat(65536) }) })).status).toBe(413);
    const overflow = mcpGateway(db, auth.mcp, env, [{ ...contextTool, output: z.object({ value: z.string() }).strict(), run: async () => ({ value: "x".repeat(32768) }) }]);
    const result = await overflow.request(origin + "/api/mcp", { method: "POST", headers: { ...headers, "mcp-method": "tools/call", "mcp-name": "get_connection_context" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_connection_context", arguments: {}, _meta: meta } }) });
    expect((await result.json() as { result: { isError: boolean } }).result.isError).toBe(true);
    expect(pageLimit.parse(undefined)).toBe(25); expect(() => pageLimit.parse(51)).toThrow();
    expect(await owned(owner, (tx) => tx.select().from(mcpRequestLeases).where(eq(mcpRequestLeases.connectionId, token.connectionId)))).toEqual([]);
  });
  it("preserves modern MCP headers through the Next bridge and strips cookies in both directions", async () => {
    // Load the web workspace at runtime, retaining the API's own compiler root.
    const bridgePath = new URL("../../../web/src/app/api/mcp/route.ts", import.meta.url).href;
    const { POST: proxyMcp } = await import(bridgePath) as { POST: (request: Request) => Promise<Response> };
    const token = await connect();
    const previousApi = process.env.API_URL;
    process.env.API_URL = origin;
    const nativeFetch = globalThis.fetch;
    const forwarded: Headers[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/api/mcp")) forwarded.push(new Headers(init?.headers));
      return nativeFetch(input, init);
    });
    const client = new Client({ name: "synthetic-proxy", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    const transport = new StreamableHTTPClientTransport(new URL(origin + "/api/mcp"), { requestInit: { headers: { authorization: "Bearer " + token.access_token } }, fetch: async (input, init) => {
      const headers = new Headers(init?.headers); headers.set("host", new URL(origin).host); headers.set("cookie", owner.headers.get("cookie")!);
      const response = await proxyMcp(new Request(String(input), { ...init, headers }));
      expect(response.headers.has("set-cookie")).toBe(false);
      return response;
    } });
    try {
      await client.connect(transport);
      expect((await client.callTool({ name: "get_connection_context", arguments: {} })).isError).not.toBe(true);
      expect(forwarded.some((h) => h.get("mcp-method") === "tools/call" && h.get("mcp-name") === "get_connection_context")).toBe(true);
      expect(forwarded.every((h) => !h.has("cookie") && h.get("host") === new URL(origin).host)).toBe(true);
      const denied = await proxyMcp(new Request(origin + "/api/mcp", { method: "POST", headers: { host: new URL(origin).host, cookie: owner.headers.get("cookie")!, "content-type": "application/json" }, body: "{}" }));
      expect(denied.status).toBe(401); expect(denied.headers.get("www-authenticate")).toContain("oauth-protected-resource/api/mcp");
    } finally { await client.close(); spy.mockRestore(); if (previousApi === undefined) delete process.env.API_URL; else process.env.API_URL = previousApi; }
  });
  it("rechecks the grant in the tool transaction and respects logical read policy", async () => {
    const token = await connect();
    await auth.mcp.withGrantContext(bearer(token.access_token), ["shopping:read"], async (tx, identity) => {
      const rows = await tx.select({ id: households.id }).from(households); expect(rows.map((h) => h.id)).toEqual([owner.householdId]);
      await checkOperation(tx, env, identity, { module: "core", access: "read" });
      await expect(checkOperation(tx, env, identity, { module: "core", access: "write" })).rejects.toThrow();
    });
    await owned(owner, async (tx) => { await tx.update(householdMembers).set({ role: "admin" }).where(eq(householdMembers.id, owner.memberId)); });
    await expect(auth.mcp.withGrantContext(bearer(token.access_token), [], async () => "unreachable")).rejects.toThrow();
    await owned(owner, async (tx) => { await tx.update(householdMembers).set({ role: "owner" }).where(eq(householdMembers.id, owner.memberId)); });
    const replacement = await connect();
    const identity = await auth.mcp.authorize(bearer(replacement.access_token));
    await metadataContext(db, identity, async (tx) => {
      await checkOperation(tx, { ...env, DEPLOYMENT_MODE: "shared" }, identity, { access: "read" });
      await expect(checkOperation(tx, { ...env, DEPLOYMENT_MODE: "shared" }, identity, { access: "write" })).rejects.toThrow();
    });
    await owned(owner, async (tx) => { await tx.insert(householdSubscriptions).values({ householdId: owner.householdId, modulesEntitled: '["core"]', status: "canceled" }); });
    try {
      await auth.mcp.withGrantContext(bearer(replacement.access_token), ["shopping:read"], async (tx, current) => {
        await checkOperation(tx, { ...env, DEPLOYMENT_MODE: "shared" }, current, { module: "core", access: "read" });
        await expect(checkOperation(tx, { ...env, DEPLOYMENT_MODE: "shared" }, current, { module: "core", access: "write" })).rejects.toMatchObject({ code: "subscription_read_only", status: 402 });
      });
      await owned(owner, async (tx) => { await tx.update(householdSubscriptions).set({ modulesEntitled: '[]' }).where(eq(householdSubscriptions.householdId, owner.householdId)); });
      await expect(auth.mcp.withGrantContext(bearer(replacement.access_token), ["shopping:read"], (tx, current) => checkOperation(tx, { ...env, DEPLOYMENT_MODE: "shared" }, current, { module: "core", access: "read" }))).rejects.toMatchObject({ code: "tool_unavailable" });
    } finally { await owned(owner, async (tx) => { await tx.delete(householdSubscriptions).where(eq(householdSubscriptions.householdId, owner.householdId)); }); }
  });
  it("shares concurrency and 30/120 minute budgets across gateway instances", async () => {
    const token = await connect(), identity = await auth.mcp.authorize(bearer(token.access_token));
    await owned(owner, async (tx) => { await tx.delete(mcpHouseholdWindows); await tx.delete(mcpConnectionWindows); });
    const pair = await Promise.all([admit(db, identity, "protocol"), admit(db, identity, "protocol")]);
    expect(pair.every((a) => a.allowed)).toBe(true);
    expect((await admit(db, identity, "protocol")).allowed).toBe(false);
    for (const admission of pair) await finish(db, identity, admission.id, "protocol_completed", 1, 0);
    await owned(owner, async (tx) => { await tx.update(mcpConnectionWindows).set({ calls: 30 }); });
    expect((await admit(db, identity, "protocol")).allowed).toBe(false);
    const before = await owned(owner, (tx) => tx.select().from(mcpAccessEvents).where(eq(mcpAccessEvents.connectionId, token.connectionId)));
    expect((await admit(db, identity, "protocol")).allowed).toBe(false);
    const after = await owned(owner, (tx) => tx.select().from(mcpAccessEvents).where(eq(mcpAccessEvents.connectionId, token.connectionId)));
    expect(after.length).toBe(before.length);
    await owned(owner, async (tx) => { await tx.update(mcpConnectionWindows).set({ calls: 0, throttled: false }); await tx.update(mcpHouseholdWindows).set({ calls: 120 }); });
    expect((await admit(db, identity, "protocol")).allowed).toBe(false);
    await owned(owner, async (tx) => { await tx.delete(mcpHouseholdWindows); await tx.delete(mcpConnectionWindows); });
  });
  it("retains active rotated refresh rows while deleting expired audit metadata", async () => {
    const token = await connect();
    expect((await refresh(token.refresh_token)).status).toBe(200);
    const prior = await withMcpProviderContext(db, (tx) => tx.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.referenceId, token.connectionId)));
    const eventId = randomUUID();
    await owned(owner, async (tx) => { await tx.insert(mcpAccessEvents).values({ id: eventId, requestId: eventId, householdId: owner.householdId, actorUserId: owner.userId, connectionId: token.connectionId, tool: "protocol", outcome: "succeeded", createdAt: new Date(Date.now() - 31 * 86400000) }); });
    expect(await pruneMcpMetadata(db)).toBeGreaterThan(0);
    expect(await owned(owner, (tx) => tx.select().from(mcpAccessEvents).where(eq(mcpAccessEvents.id, eventId)))).toEqual([]);
    const remaining = await withMcpProviderContext(db, (tx) => tx.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.referenceId, token.connectionId)));
    expect(remaining.length).toBe(prior.length);
    expect((await owned(owner, (tx) => tx.select().from(mcpConnections).where(eq(mcpConnections.id, token.connectionId))))[0].status).toBe("active");
  });
  it("retains revoked tombstones until all credentials expire, then purges them", async () => {
    const token = await connect();
    const [grant] = await owned(owner, (tx) => tx.select().from(mcpConnections).where(eq(mcpConnections.id, token.connectionId)));
    const expiredId = randomUUID(), credentialId = randomUUID();
    const old = new Date(Date.now() - 32 * 86400000), expired = new Date(Date.now() - 2 * 86400000);
    await owned(owner, async (tx) => { await tx.insert(mcpConnections).values({ ...grant, id: expiredId, status: "revoked", createdAt: old, activatedAt: old, expiresAt: expired, revokedAt: expired, adultAttestedAt: old, privacyAttestedAt: old }); });
    await withMcpProviderContext(db, async (tx) => { await tx.insert(oauthRefreshToken).values({ id: credentialId, token: randomUUID(), clientId, userId: owner.userId, referenceId: expiredId, scopes: grant.scopes, expiresAt: new Date(Date.now() + 3600000) }); });
    await pruneMcpMetadata(db);
    expect(await owned(owner, (tx) => tx.select().from(mcpConnections).where(eq(mcpConnections.id, expiredId)))).toHaveLength(1);
    await withMcpProviderContext(db, async (tx) => { await tx.update(oauthRefreshToken).set({ expiresAt: expired }).where(eq(oauthRefreshToken.id, credentialId)); });
    await pruneMcpMetadata(db);
    expect(await owned(owner, (tx) => tx.select().from(mcpConnections).where(eq(mcpConnections.id, expiredId)))).toEqual([]);
    expect(await withMcpProviderContext(db, (tx) => tx.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.id, credentialId)))).toEqual([]);
  });
  it("cancels a slow request body at the 10-second deadline and releases admission", async () => {
    const token = await connect();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0",')); }, cancel() { cancelled = true; } });
    const request = new Request(origin + "/api/mcp", { method: "POST", headers: { host: new URL(origin).host, authorization: "Bearer " + token.access_token, "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
    const started = performance.now();
    const response = await mcpGateway(db, auth.mcp, env).fetch(request);
    expect(response.status).toBe(504); expect(performance.now() - started).toBeLessThan(11000);
    expect(cancelled).toBe(true);
    let leases: unknown[] = [];
    for (let i = 0; i < 20; i++) {
      leases = await owned(owner, (tx) => tx.select().from(mcpRequestLeases).where(eq(mcpRequestLeases.connectionId, token.connectionId)));
      if (!leases.length) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(leases).toEqual([]);
    expect((await owned(owner, (tx) => tx.select().from(mcpAccessEvents).where(eq(mcpAccessEvents.connectionId, token.connectionId))))[0].outcome).toBe("deadline_exceeded");
  }, 15000);
  it("serves all four pure read tools through the SDK without domain, queue or notification effects", async () => {
    const itemId = randomUUID(), choreId = randomUUID();
    await owned(owner, async (tx) => {
      const [template] = await tx.insert(shoppingRecurring).values({ householdId: owner.householdId, item: "UNMATERIALIZED-SHOPPING", nextAt: "2020-01-01", enabled: true }).returning();
      await tx.insert(shoppingItems).values({ id: itemId, householdId: owner.householdId, item: "Milk", quantity: 2, unit: "litres", notes: "ITEM-NOTE-EXCLUDED", cost: 999, tagsJson: '["aisle:dairy","TAG-EXCLUDED"]' });
      const [choreTemplate] = await tx.insert(choresRecurring).values({ householdId: owner.householdId, description: "UNMATERIALIZED-CHORE", nextAt: "2020-01-01" }).returning();
      await tx.insert(chores).values({ id: choreId, householdId: owner.householdId, description: "Wash dishes\nLONG-DESCRIPTION-EXCLUDED", assigneeMemberId: owner.memberId, dueDate: "2020-01-01", recurringId: choreTemplate.id, missedCount: 2, dueReminderSentAt: new Date(), tagsJson: '["CHORE-TAG-EXCLUDED"]' });
      expect(template.enabled).toBe(true);
    });
    await owned(stranger, async (tx) => { await tx.insert(shoppingItems).values({ householdId: stranger.householdId, item: "FOREIGN-SHOPPING" }); await tx.insert(chores).values({ householdId: stranger.householdId, description: "FOREIGN-CHORE" }); });
    const { token } = await toolAccess([ownNote]);
    const before = await domainSnapshot();
    sideEffects.enqueue.mockClear(); sideEffects.notify.mockClear();
    const client = new Client({ name: "synthetic-domain-tools", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(origin + "/api/mcp"), { requestInit: { headers: { authorization: "Bearer " + token.access_token } } }));
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["get_connection_context", "list_shopping_items", "list_chores", "list_selected_notes", "get_selected_note"]);
      const results = [];
      for (const [name, args] of [["list_shopping_items", {}], ["list_chores", {}], ["list_selected_notes", {}], ["get_selected_note", { noteId: ownNote }]] as const) {
        const result = await client.callTool({ name, arguments: args }); expect(result.isError, JSON.stringify(result)).not.toBe(true); results.push(result.structuredContent);
      }
      expect(results[0]).toMatchObject({ coverage: "persisted_records_only", contentTrust: "untrusted", data: [expect.objectContaining({ id: itemId, title: "Milk", aisle: "dairy", quantity: 2 })] });
      expect(results[1]).toMatchObject({ data: [expect.objectContaining({ id: choreId, title: "Wash dishes", titleTruncated: true, dueDate: "2020-01-01", assignee: "Synthetic Adult" })] });
      expect(results[3]).toMatchObject({ data: { id: ownNote, text: "synthetic", textOmitted: false } });
      const serialized = JSON.stringify(results);
      for (const excluded of ["ITEM-NOTE-EXCLUDED", "TAG-EXCLUDED", "LONG-DESCRIPTION-EXCLUDED", "CHORE-TAG-EXCLUDED", "UNMATERIALIZED", "FOREIGN-"]) expect(serialized).not.toContain(excluded);
      const invalid = await client.callTool({ name: "list_shopping_items", arguments: { householdId: stranger.householdId } }); expect(invalid.isError).toBe(true);
    } finally { await client.close(); }
    expect(await domainSnapshot()).toEqual(before);
    expect(sideEffects.enqueue).not.toHaveBeenCalled(); expect(sideEffects.notify).not.toHaveBeenCalled();
    const events = await owned(owner, (tx) => tx.select().from(mcpAccessEvents).where(eq(mcpAccessEvents.connectionId, token.connectionId)));
    expect(events.some((event) => event.tool === "get_selected_note" && event.outcome === "succeeded")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("synthetic-domain-tools"); expect(JSON.stringify(events)).not.toContain("Wash dishes");
  });
  it("pages persisted lists within byte bounds and binds cursors to grant, tool and filters", async () => {
    const prefix = "刀".repeat(85);
    await owned(owner, async (tx) => { await tx.insert(shoppingItems).values(Array.from({ length: 55 }, (_, i) => ({ householdId: owner.householdId, item: i === 2 ? "😺".repeat(256) : prefix + i, checked: i === 0, tagsJson: '["aisle:' + "冷".repeat(200) + '"]' }))); });
    const access = await toolAccess();
    const first = await access.run("list_shopping_items", { limit: 50, checked: "all" });
    expect(first.truncated).toBe(true); expect((first.data as unknown[]).length).toBeLessThan(50);
    const seen: string[] = []; let current = first;
    for (let page = 0; page < 10; page++) {
      expect(Buffer.byteLength(JSON.stringify(current)) * 2).toBeLessThan(32768 - 1024);
      seen.push(...(current.data as { id: string }[]).map((row) => row.id));
      if (!current.nextCursor) break;
      current = await access.run("list_shopping_items", { limit: 50, checked: "all", cursor: current.nextCursor });
    }
    const all = await owned(owner, (tx) => tx.select({ id: shoppingItems.id }).from(shoppingItems));
    expect(new Set(seen).size).toBe(all.length); expect(seen.length).toBe(all.length);
    await expect(access.run("list_shopping_items", { checked: "open", cursor: first.nextCursor })).rejects.toThrow();
    await expect(access.run("list_chores", { cursor: first.nextCursor })).rejects.toThrow();
    await expect(access.run("list_shopping_items", { checked: "all", cursor: first.nextCursor!.slice(0, -2) + "xx" })).rejects.toThrow();
    const replacement = await toolAccess();
    await expect(replacement.run("list_shopping_items", { checked: "all", cursor: first.nextCursor })).rejects.toThrow();
    await expect(replacement.run("list_shopping_items", { limit: 51 })).rejects.toThrow();
    await expect(replacement.run("list_chores", { dueBefore: "2026-02-30" })).rejects.toThrow();
    expect((await replacement.run("list_chores", { dueBefore: "2019-12-31" })).data).toEqual([]);
  });
  it("requires selection and live note ACLs for every read, including continuation", async () => {
    const [shared] = await owned(colleague, (tx) => tx.insert(notes).values({ householdId: owner.householdId, title: "Shared synthetic", content: "part ".repeat(3000), visibility: "private", createdByUserId: colleague.userId }).returning());
    await owned(colleague, async (tx) => { await tx.insert(noteShares).values({ noteId: shared.id, memberId: owner.memberId }); });
    const access = await toolAccess([ownNote, shared.id]);
    const first = await access.run("get_selected_note", { noteId: shared.id }); expect(first.nextCursor).toBeTruthy();
    await owned(colleague, async (tx) => { await tx.delete(noteShares).where(eq(noteShares.noteId, shared.id)); });
    const failures = [];
    for (const args of [{ noteId: shared.id, cursor: first.nextCursor }, { noteId: foreignNote }, { noteId: randomUUID() }]) {
      try { await access.run("get_selected_note", args); throw new Error("unexpected_success"); } catch (error) { failures.push((error as Error).message); }
    }
    expect(failures).toEqual(["note_unavailable", "note_unavailable", "note_unavailable"]);
    expect((await access.run("list_selected_notes")).data).toEqual([expect.objectContaining({ id: ownNote })]);
    await owned(owner, async (tx) => { await tx.delete(mcpNoteSelections).where(and(eq(mcpNoteSelections.connectionId, access.token.connectionId), eq(mcpNoteSelections.noteId, ownNote))); });
    await expect(access.run("get_selected_note", { noteId: ownNote })).rejects.toMatchObject({ code: "note_unavailable" });
  });
  it("chunks Unicode note text without gaps and invalidates continuation when content changes", async () => {
    const content = "😺漢字\"\\\n".repeat(2000);
    const [note] = await owned(owner, (tx) => tx.insert(notes).values({ householdId: owner.householdId, title: "😺".repeat(256), content }).returning());
    const access = await toolAccess([note.id]);
    let result = await access.run("get_selected_note", { noteId: note.id }); const oldCursor = result.nextCursor;
    expect(result.data).toMatchObject({ titleTruncated: true });
    const chunks: string[] = [];
    for (let page = 0; page < 20; page++) {
      const data = result.data as { text: string };
      expect(Array.from(data.text).length).toBeLessThanOrEqual(6000);
      expect(Buffer.byteLength(JSON.stringify({ structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] }))).toBeLessThanOrEqual(32768 - 2048);
      chunks.push(data.text);
      if (!result.nextCursor) break;
      result = await access.run("get_selected_note", { noteId: note.id, cursor: result.nextCursor });
    }
    expect(chunks.join("")).toBe(content);
    await owned(owner, async (tx) => { await tx.update(notes).set({ content: "Changed" }).where(eq(notes.id, note.id)); });
    await expect(access.run("get_selected_note", { noteId: note.id, cursor: oldCursor })).rejects.toMatchObject({ code: "note_unavailable" });
    expect((await access.run("get_selected_note", { noteId: note.id })).data).toMatchObject({ text: "Changed" });
  });
  it("omits linked, embedded and HTML content without loading an external resource", async () => {
    const contents = ["Native\n[[drive:" + randomUUID() + "|PRIVATE-EMBED]]", "\\[\\[drive:secret\\]\\]", "[Google](https://docs.google.com/private)", "![file](/private/file)", "[file][ref]\n[ref]: /private/file", "<iframe src='/private'></iframe>"];
    const rows = await owned(owner, (tx) => tx.insert(notes).values(contents.map((content, i) => ({ householdId: owner.householdId, title: "Omitted " + i, content }))).returning());
    const access = await toolAccess(rows.map((row) => row.id));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      for (const row of rows) {
        const result = await access.run("get_selected_note", { noteId: row.id });
        expect(result.data).toMatchObject({ text: "", textOmitted: true, omissionReason: "linked_or_embedded_content" }); expect(result.nextCursor).toBeNull();
      }
      expect(fetchSpy.mock.calls.every(([input]) => String(input).startsWith(origin))).toBe(true);
    } finally { fetchSpy.mockRestore(); }
  });
  it("enforces scopes and hosted entitlements in discovery and domain execution", async () => {
    const access = await toolAccess([], ["shopping:read", "offline_access"]);
    await expect(access.run("list_chores")).rejects.toMatchObject({ code: "insufficient_scope" });
    await expect(access.run("list_selected_notes")).rejects.toMatchObject({ code: "insufficient_scope" });
    await owned(owner, async (tx) => { await tx.insert(householdSubscriptions).values({ householdId: owner.householdId, modulesEntitled: '["core"]', status: "canceled" }); });
    const gateway = mcpGateway(db, auth.mcp, { ...env, DEPLOYMENT_MODE: "shared" });
    const request = (method: string, params: Record<string, unknown> = {}) => gateway.request(origin + "/api/mcp", { method: "POST", headers: { host: new URL(origin).host, authorization: "Bearer " + access.token.access_token, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-method": method, ...(method === "tools/call" ? { "mcp-name": "list_shopping_items" } : {}), "mcp-protocol-version": "2026-07-28" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "synthetic", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } }) });
    try {
      const read = await request("tools/call", { name: "list_shopping_items", arguments: { limit: 1 } });
      expect((await read.json() as { result: { isError?: boolean } }).result.isError).not.toBe(true);
      await owned(owner, async (tx) => { await tx.update(householdSubscriptions).set({ modulesEntitled: '[]' }).where(eq(householdSubscriptions.householdId, owner.householdId)); });
      const listed = await request("tools/list"); expect((await listed.json() as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name)).toEqual(["get_connection_context"]);
      const denied = await request("tools/call", { name: "list_shopping_items", arguments: {} }); expect(JSON.stringify(await denied.json())).not.toContain("Milk");
    } finally { await owned(owner, async (tx) => { await tx.delete(householdSubscriptions).where(eq(householdSubscriptions.householdId, owner.householdId)); }); }
  });
  it("publishes deployment-local discovery and public-only JWKS; blocks generic JWT and client administration", async () => {
    const metadata = await (await fetch(origin + "/.well-known/oauth-authorization-server/auth")).json() as { issuer: string; code_challenge_methods_supported: string[]; grant_types_supported: string[]; registration_endpoint?: string };
    expect(metadata.issuer).toBe(origin + "/auth"); expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(metadata.registration_endpoint).toBeUndefined();
    expect((await fetch(origin + "/auth/token", { headers: owner.headers })).status).toBe(404);
    expect((await post("/auth/oauth2/register", { redirect_uris: [callback] })).status).toBeGreaterThanOrEqual(400);
    expect((await post("/auth/oauth2/create-client", { redirect_uris: [callback] })).status).toBeGreaterThanOrEqual(400);
    const jwks = await (await fetch(origin + "/auth/jwks")).json() as { keys: Record<string, unknown>[] };
    expect(jwks.keys.length).toBeGreaterThan(0); expect(jwks.keys.every((k: Record<string, unknown>) => !k.d && !k.privateKey)).toBe(true);
  });
  it("preserves ordinary sessions with a path in PUBLIC_APP_URL when MCP is disabled", async () => {
    const off = createBetterAuth(db, { ...env, MCP_ENABLED: false, PUBLIC_APP_URL: origin + "/prefix" }, { cookiePrefix });
    expect((await off.api.getSession({ headers: owner.headers }))?.user?.id).toBe(owner.userId);
    expect((await off.handler(new Request(origin + "/auth/oauth2/authorize"))).status).toBe(404);
    expect(() => off.mcp).toThrow("mcp_disabled");
  });
  it("issues bound tokens, preserves browser sessions, and stores hashed refresh credentials", async () => {
    const token = await connect();
    expect(await auth.mcp.authorize(bearer(token.access_token), ["shopping:read"])).toMatchObject({ userId: owner.userId, householdId: owner.householdId, memberId: owner.memberId, connectionId: token.connectionId });
    expect((await auth.api.getSession({ headers: owner.headers }))?.user?.id).toBe(owner.userId);
    const [stored] = await withMcpProviderContext(db, (tx) => tx.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.referenceId, token.connectionId)));
    expect(stored.token).not.toBe(token.refresh_token); expect(stored.token).not.toContain(token.refresh_token);
    await expect(auth.mcp.authorize(bearer(token.access_token), ["notes:read"])).rejects.toMatchObject({ code: "insufficient_scope", status: 403 });
  });
  it("resumes a signed authorization query through fresh login and binds consent to the new session", async () => {
    const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: callback, scope: "shopping:read offline_access",
      resource: origin + "/api/mcp", state: randomUUID(), code_challenge: challenge, code_challenge_method: "S256" });
    const initial = await fetch(origin + "/auth/oauth2/authorize?" + params, { headers: { accept: "text/html" }, redirect: "manual" });
    const initialBody = initial.headers.has("location") ? null : await initial.json() as { url?: string; redirect_uri?: string; error?: string; error_description?: string };
    if (initialBody?.error) throw new Error(`${initial.status}: ${initialBody.error}: ${initialBody.error_description}`);
    const login = new URL(initial.headers.get("location") ?? initialBody?.redirect_uri ?? initialBody?.url!, origin); expect(login.pathname).toBe("/login");
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, owner.userId));
    const headers = new Headers({ origin, "content-type": "application/json" });
    const signedIn = await post("/auth/sign-in/email", { email: user.email, password: "Synthetic-only-test-password-2026", oauth_query: login.searchParams.toString() }, owner, headers);
    expect(signedIn.status).toBe(200);
    const body = await signedIn.json() as { url?: string; redirect_uri?: string };
    const consent = new URL(signedIn.headers.get("location") ?? body.redirect_uri ?? body.url!, origin);
    expect(consent.pathname).toBe("/ai/consent");
    headers.set("cookie", signedIn.headers.getSetCookie().map((s) => s.split(";")[0]).join("; "));
    const fresh = { ...owner, headers };
    const query = consent.searchParams.toString(); const pending = await prepare(query, fresh);
    expect((await decide(query, pending.pendingId, true, owner)).status).toBe(409);
    const decision = await (await decide(query, pending.pendingId, true, fresh)).json() as { redirectUri: string };
    expect((await exchange(new URL(decision.redirectUri).searchParams.get("code")!)).status).toBe(200);
  });
  it("keeps unapproved profiles disabled and consumer Gemini synthetic-only", async () => {
    const input = { name: "Synthetic policy fixture", redirectUris: [callback], tokenEndpointAuthMethod: "none" as const, scopes,
      provider: "gemini", profileVersion: "synthetic-v1", dataMode: "household" as const };
    await expect(auth.mcp.registerClient(owner.headers, input)).rejects.toMatchObject({ code: "synthetic_client_only" });
    const client = await auth.mcp.registerClient(owner.headers, { ...input, provider: "local", dataMode: "synthetic" });
    clientIds.push(client.client_id);
    const query = await begin(owner, ["shopping:read", "offline_access"], client.client_id);
    const response = await post("/api/mcp-auth/consents/prepare", { householdId: owner.householdId, oauthQuery: query, noteIds: [], adultAttested: true, privacyAttested: true, policyVersion: MCP_POLICY_VERSION });
    expect(response.status).toBe(403);
  });
  it("requires a bearer even with a valid cookie, and rejects wrong audience, scope escalation and expired JWT", async () => {
    const token = await connect();
    await expect(auth.mcp.authorize(new Request(origin + "/api/mcp", { headers: owner.headers }))).rejects.toMatchObject({ status: 401 });
    const wrong = await refresh(token.refresh_token, { resource: origin + "/wrong" }); expect(wrong.status).toBeGreaterThanOrEqual(400);
    const escalation = await refresh(token.refresh_token, { scope: "shopping:read notes:read offline_access" }); expect(escalation.status).toBeGreaterThanOrEqual(400);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 600_000));
    try { await expect(auth.mcp.authorize(bearer(token.access_token))).rejects.toMatchObject({ status: 401 }); }
    finally { vi.useRealTimers(); }
  });
  it("rejects signature-valid JWTs with wrong issuer/audience/client/user, missing expiry, excess scope or DPoP binding", async () => {
    const token = await connect();
    const header = decodeProtectedHeader(token.access_token);
    if (header.alg !== "EdDSA") throw new Error("Expected the fixture's default EdDSA signing key");
    const algorithm = header.alg;
    const [stored] = await withMcpProviderContext(db, (tx) => tx.select().from(jwks).where(eq(jwks.id, header.kid!)));
    const key = await importJWK(JSON.parse(await symmetricDecrypt({ key: env.SESSION_SECRET!, data: JSON.parse(stored.privateKey) })), header.alg);
    const claims = decodeJwt(token.access_token);
    for (const override of [
      { iss: origin + "/foreign/auth" }, { aud: origin + "/wrong" }, { aud: [origin + "/api/mcp", origin + "/wrong"] }, { client_id: "foreign-client", azp: "foreign-client" },
      { sub: stranger.userId }, { exp: undefined }, { scope: "notes:read" }, { cnf: { jkt: "synthetic-sender-binding" } },
    ]) {
      const invalid = await new SignJWT({ ...claims, ...override }).setProtectedHeader({ ...header, alg: algorithm }).sign(key);
      await expect(auth.mcp.authorize(bearer(invalid)), Object.keys(override).join(",")).rejects.toMatchObject({ status: 401 });
    }
  });
  it("supports operator-registered confidential clients and hashes their secrets", async () => {
    const client = await auth.mcp.registerClient(owner.headers, { name: "Synthetic confidential", redirectUris: [callback], tokenEndpointAuthMethod: "client_secret_post", scopes,
      provider: "local", profileVersion: "synthetic-v1", dataMode: "synthetic", enabled: true });
    clientIds.push(client.client_id);
    const query = await begin(owner, ["shopping:read", "offline_access"], client.client_id);
    const pending = await prepare(query);
    const decision = await (await decide(query, pending.pendingId)).json() as { redirectUri: string };
    const code = new URL(decision.redirectUri).searchParams.get("code")!;
    const response = await exchange(code, { client_id: client.client_id, client_secret: client.client_secret! });
    expect(response.status).toBe(200);
    const tokens = await response.json() as Tokens;
    expect(await auth.mcp.authorize(bearer(tokens.access_token))).toMatchObject({ userId: owner.userId });
    const [stored] = await withMcpProviderContext(db, (tx) => tx.select().from(oauthClient).where(eq(oauthClient.clientId, client.client_id)));
    expect(stored.clientSecret).toBeTruthy(); expect(stored.clientSecret).not.toBe(client.client_secret);
  });
  it("rejects wrong PKCE and authorization-code replay", async () => {
    const q = await begin(); const pending = await prepare(q); const response = await decide(q, pending.pendingId);
    const result = await response.json() as { redirectUri: string }; const code = new URL(result.redirectUri).searchParams.get("code")!;
    expect((await exchange(code, { code_verifier: "x".repeat(64) })).status).toBeGreaterThanOrEqual(400);
    const token = await connect(); expect((await exchange(token.code)).status).toBeGreaterThanOrEqual(400);
  });
  it("isolates two tabs and rejects tampered, cross-session and replayed pending decisions", async () => {
    const [a, b] = await Promise.all([begin(), begin(owner, ["chores:read", "offline_access"])]);
    const [pa, pb] = await Promise.all([prepare(a), prepare(b)]);
    expect((await post("/api/mcp-auth/consents/prepare", { householdId: owner.householdId, oauthQuery: a, noteIds: [], adultAttested: true, privacyAttested: true, policyVersion: MCP_POLICY_VERSION })).status).toBe(409);
    expect((await decide(b, pa.pendingId)).status).toBe(409);
    expect((await decide(a, pa.pendingId, true, stranger)).status).toBe(409);
    const [ra, rb] = await Promise.all([decide(a, pa.pendingId), decide(b, pb.pendingId)]);
    expect(ra.status).toBe(200); expect(rb.status).toBe(200);
    expect((await ra.json() as { connectionId: string }).connectionId).not.toBe((await rb.json() as { connectionId: string }).connectionId);
    expect((await decide(a, pa.pendingId)).status).toBe(409);
    expect((await post("/api/mcp-auth/consents/prepare", { householdId: owner.householdId, oauthQuery: a.replace("shopping", "notes"), noteIds: [], adultAttested: true, privacyAttested: true, policyVersion: MCP_POLICY_VERSION })).status).toBe(400);
    expect((await post("/auth/oauth2/consent", { accept: true, oauth_query: a })).status).toBe(403);
    expect((await post("/auth/oauth2/continue", { postLogin: true, oauth_query: a })).status).toBe(403);
  });
  it("consumes rejection and enforces pending consent expiry", async () => {
    const q = await begin(); const p = await prepare(q);
    expect(await (await decide(q, p.pendingId, false)).json()).toEqual({ accepted: false });
    expect((await decide(q, p.pendingId)).status).toBe(409);
    const other = await begin(); const pending = await prepare(other);
    await withUserLookupContext(db, owner.userId, (tx) => tx.update(mcpPendingConsents).set({ expiresAt: new Date(0) }).where(eq(mcpPendingConsents.id, pending.pendingId)));
    expect((await decide(other, pending.pendingId)).status).toBe(409);
  });
  async function activeConnections() {
    return owned(owner, (tx) => tx.select({ id: mcpConnections.id }).from(mcpConnections).where(and(
      eq(mcpConnections.userId, owner.userId), eq(mcpConnections.clientId, clientId), eq(mcpConnections.status, "active"),
    )));
  }
  it("consumes the same pending consent exactly once under concurrent decisions", async () => {
    const q = await begin(); const p = await prepare(q);
    const results = await Promise.all([decide(q, p.pendingId), decide(q, p.pendingId)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await activeConnections()).toHaveLength(1);
    expect((await decide(q, p.pendingId)).status).toBe(409);
  });
  it("redeems an authorization code exactly once under concurrent exchange", async () => {
    const q = await begin(); const p = await prepare(q);
    const decision = await (await decide(q, p.pendingId)).json() as { redirectUri: string };
    const code = new URL(decision.redirectUri).searchParams.get("code")!;
    const results = await Promise.all([exchange(code), exchange(code)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status >= 400)).toHaveLength(1);
    // Code replay may defensively revoke the newly issued token family.
    expect((await activeConnections()).length).toBeLessThanOrEqual(1);
    expect((await exchange(code)).status).toBeGreaterThanOrEqual(400);
  });
  it("rotates a refresh token exactly once under concurrent redemption", async () => {
    const token = await connect();
    const results = await Promise.all([refresh(token.refresh_token), refresh(token.refresh_token)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status >= 400)).toHaveLength(1);
    expect((await refresh(token.refresh_token)).status).toBeGreaterThanOrEqual(400);
  });
  it("requires explicit adult/privacy consent and excludes child and foreign household access", async () => {
    const query = await begin();
    const input = { householdId: owner.householdId, oauthQuery: query, noteIds: [], adultAttested: true, privacyAttested: true, policyVersion: MCP_POLICY_VERSION };
    expect((await post("/api/mcp-auth/consents/prepare", { ...input, adultAttested: false })).status).toBe(400);
    expect((await post("/api/mcp-auth/consents/prepare", { ...input, privacyAttested: false })).status).toBe(400);
    expect((await post("/api/mcp-auth/consents/prepare", { ...input, householdId: stranger.householdId })).status).toBe(403);
    expect((await post("/api/mcp-auth/consents/prepare", { ...input, householdId: child.householdId }, child)).status).toBe(403);
    expect((await post("/api/mcp-auth/household", { householdId: owner.householdId, enabled: false }, colleague)).status).toBe(403);
    const headers = new Headers(owner.headers); headers.delete("origin");
    expect((await post("/api/mcp-auth/consents/prepare", input, owner, headers)).status).toBe(403);
    headers.set("origin", "https://untrusted.example.test"); expect((await post("/api/mcp-auth/consents/prepare", input, owner, headers)).status).toBe(403);
  });
  it("allows only selected accessible same-household notes", async () => {
    const query = await begin(owner, ["notes:read", "offline_access"]);
    const input = { householdId: owner.householdId, oauthQuery: query, noteIds: [foreignNote], adultAttested: true, privacyAttested: true, policyVersion: MCP_POLICY_VERSION };
    expect((await post("/api/mcp-auth/consents/prepare", input)).status).toBe(403);
    expect((await post("/api/mcp-auth/consents/prepare", { ...input, noteIds: [ownNote] }, colleague)).status).toBe(403);
    const token = await connect(owner, ["notes:read", "offline_access"], [ownNote]);
    expect(await owned(owner, (tx) => tx.select().from(mcpNoteSelections).where(eq(mcpNoteSelections.connectionId, token.connectionId)))).toHaveLength(1);
    await expect(owned(owner, (tx) => tx.insert(mcpNoteSelections).values({ householdId: owner.householdId, connectionId: token.connectionId, noteId: foreignNote }))).rejects.toThrow();
  });
  it("rotates refresh tokens and rejects reuse and refresh after disconnect", async () => {
    const first = await connect(); const response = await refresh(first.refresh_token); expect(response.status).toBe(200);
    const second = await response.json() as Tokens; expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await auth.mcp.authorize(bearer(second.access_token))).toMatchObject({ connectionId: first.connectionId });
    expect((await refresh(first.refresh_token)).status).toBeGreaterThanOrEqual(400);
    await expect(auth.mcp.authorize(bearer(second.access_token))).rejects.toMatchObject({ status: 401 });
    const clean = await connect(); expect((await auth.mcp.revokeConnection(owner.headers, clean.connectionId)).revoked).toBe(true);
    await expect(auth.mcp.authorize(bearer(clean.access_token))).rejects.toMatchObject({ status: 401 });
    expect((await refresh(clean.refresh_token)).status).toBeGreaterThanOrEqual(400);
  });
  it("propagates standard provider refresh-token revocation to outstanding JWT access", async () => {
    const token = await connect();
    const response = await fetch(origin + "/auth/oauth2/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, token: token.refresh_token, token_type_hint: "refresh_token" }) });
    expect(response.status).toBe(200);
    await expect(auth.mcp.authorize(bearer(token.access_token))).rejects.toMatchObject({ status: 401 });
    expect((await refresh(token.refresh_token)).status).toBeGreaterThanOrEqual(400);
  });
  (process.env.MCP_TEST_ADMIN_DATABASE_URL ? it : it.skip)("commits local revocation when provider cleanup fails", async () => {
    const admin = createDb(process.env.MCP_TEST_ADMIN_DATABASE_URL!);
    const token = await connect();
    try {
      await admin.execute(sql`revoke update on mcp_oauth_refresh_tokens from domi_ops_oauth`);
      expect(await auth.mcp.revokeConnection(owner.headers, token.connectionId)).toEqual({ revoked: true, providerCleanupComplete: false });
      await expect(auth.mcp.authorize(bearer(token.access_token))).rejects.toMatchObject({ status: 401 });
    } finally {
      await admin.execute(sql`grant update on mcp_oauth_refresh_tokens to domi_ops_oauth`);
      await closeDb(admin);
    }
    expect((await refresh(token.refresh_token)).status).toBeGreaterThanOrEqual(400);
  });
  (process.env.MCP_TEST_ADMIN_DATABASE_URL ? it : it.skip)("consumes failed provider approval without leaving an active or retryable grant", async () => {
    const query = await begin(); const pending = await prepare(query);
    const admin = createDb(process.env.MCP_TEST_ADMIN_DATABASE_URL!);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await admin.execute(sql`revoke insert on mcp_oauth_consents from domi_ops_oauth`);
      expect((await decide(query, pending.pendingId)).status).toBe(409);
      const [state] = await withUserLookupContext(db, owner.userId, (tx) => tx.select().from(mcpPendingConsents).where(eq(mcpPendingConsents.id, pending.pendingId)));
      expect(state.consumedAt).toBeTruthy();
      const [connection] = await owned(owner, (tx) => tx.select().from(mcpConnections).where(eq(mcpConnections.id, state.connectionId)));
      expect(connection.status).toBe("revoked");
    } finally {
      errorLog.mockRestore();
      await admin.execute(sql`grant insert on mcp_oauth_consents to domi_ops_oauth`);
      await closeDb(admin);
    }
    expect((await decide(query, pending.pendingId)).status).toBe(409);
  });
  (process.env.MCP_TEST_ADMIN_DATABASE_URL ? it : it.skip)("keeps a replacement active when old provider cleanup fails", async () => {
    const old = await connect();
    const admin = createDb(process.env.MCP_TEST_ADMIN_DATABASE_URL!);
    try {
      await admin.execute(sql`revoke update on mcp_oauth_refresh_tokens from domi_ops_oauth`);
      const fresh = await connect();
      expect(await auth.mcp.authorize(bearer(fresh.access_token))).toMatchObject({ connectionId: fresh.connectionId });
      await expect(auth.mcp.authorize(bearer(old.access_token))).rejects.toMatchObject({ status: 401 });
      expect(await activeConnections()).toEqual([{ id: fresh.connectionId }]);
    } finally {
      await admin.execute(sql`grant update on mcp_oauth_refresh_tokens to domi_ops_oauth`);
      await closeDb(admin);
    }
    expect((await refresh(old.refresh_token)).status).toBeGreaterThanOrEqual(400);
  });
  it("reconnects with a new immutable grant and cannot expand or resurrect an old grant", async () => {
    const old = await connect();
    const fresh = await connect(owner, ["shopping:read", "notes:read", "offline_access"]);
    expect(fresh.connectionId).not.toBe(old.connectionId);
    await expect(auth.mcp.authorize(bearer(old.access_token))).rejects.toMatchObject({ status: 401 });
    expect((await refresh(old.refresh_token)).status).toBeGreaterThanOrEqual(400);
    await expect(owned(owner, (tx) => tx.update(mcpConnections).set({ status: "active", revokedAt: null }).where(eq(mcpConnections.id, old.connectionId)))).rejects.toThrow();
    await expect(owned(owner, (tx) => tx.update(mcpConnections).set({ scopes }).where(eq(mcpConnections.id, fresh.connectionId)))).rejects.toThrow();
    await owned(owner, (tx) => tx.update(mcpConnections).set({ scopes: ["shopping:read", "offline_access"] }).where(eq(mcpConnections.id, fresh.connectionId)));
    await expect(auth.mcp.authorize(bearer(fresh.access_token))).rejects.toMatchObject({ status: 401 });
  });
  it("previews verified client/identity details without preparing or granting access", async () => {
    const q = await begin(owner, ["notes:read", "offline_access"]);
    const before = await owned(owner, (tx) => tx.select({ id: mcpConnections.id }).from(mcpConnections));
    const response = await post("/api/mcp-auth/consents/preview", { householdId: owner.householdId, oauthQuery: q });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ clientId, clientName: "Synthetic fixture", householdId: owner.householdId, scopes: ["notes:read", "offline_access"], policyVersion: MCP_POLICY_VERSION });
    expect(await owned(owner, (tx) => tx.select({ id: mcpConnections.id }).from(mcpConnections))).toEqual(before);
    expect((await post("/api/mcp-auth/consents/preview", { householdId: stranger.householdId, oauthQuery: q })).status).toBe(403);
    expect((await post("/api/mcp-auth/consents/preview", { householdId: owner.householdId, oauthQuery: q.replace("notes", "shopping") })).status).toBe(400);
  });
  it("lists only the authenticated member's grants and safe note titles", async () => {
    const a = await connect(owner, ["notes:read", "offline_access"], [ownNote]);
    const b = await connect(colleague);
    const response = await post("/api/mcp-auth/overview", { householdId: owner.householdId });
    expect(response.status).toBe(200);
    const result = await response.json() as { connections: { id: string; selectedNotes: { id: string; title: string }[] }[]; canManage: boolean };
    expect(result.canManage).toBe(true);
    expect(result.connections.find((c) => c.id === a.connectionId)?.selectedNotes).toEqual([{ id: ownNote, title: "synthetic" }]);
    expect(result.connections.some((c) => c.id === b.connectionId)).toBe(false);
    const other = await (await post("/api/mcp-auth/overview", { householdId: colleague.householdId }, colleague)).json() as { connections: { id: string }[]; canManage: boolean };
    expect(other.canManage).toBe(false); expect(other.connections.some((c) => c.id === a.connectionId)).toBe(false);
    expect((await post("/api/mcp-auth/overview", { householdId: stranger.householdId })).status).toBe(403);
    const text = JSON.stringify(result);
    for (const secret of [a.refresh_token, a.access_token, "sessionId", "queryHash", "clientSecret"]) expect(text).not.toContain(secret);
  });
  it("offers only accessible same-household note titles, including literal searches", async () => {
    const result = await (await post("/api/mcp-auth/notes", { householdId: owner.householdId })).json() as { notes: { id: string; title: string; content?: string }[] };
    expect(result.notes.some((n) => n.id === ownNote)).toBe(true); expect(result.notes.some((n) => n.id === foreignNote)).toBe(false);
    expect(result.notes.every((n) => n.content === undefined)).toBe(true);
    const other = await (await post("/api/mcp-auth/notes", { householdId: colleague.householdId }, colleague)).json() as typeof result;
    expect(other.notes.some((n) => n.id === ownNote)).toBe(false);
    expect(await (await post("/api/mcp-auth/notes", { householdId: owner.householdId, search: "%" })).json()).toEqual({ notes: [] });
  });
  it("denies without attestations and consumes any prepared consent", async () => {
    const q = await begin();
    const result = await post("/api/mcp-auth/consents/reject", { oauthQuery: q });
    expect(result.status).toBe(200);
    const redirect = new URL((await result.json() as { redirectUri: string }).redirectUri);
    expect(redirect.origin + redirect.pathname).toBe(callback);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe(new URLSearchParams(q).get("state"));
    expect(redirect.searchParams.has("code")).toBe(false);
    const p = await prepare(q);
    expect((await post("/api/mcp-auth/consents/reject", { oauthQuery: q })).status).toBe(200);
    expect((await decide(q, p.pendingId)).status).toBe(409);
  });
  it("keeps denial final when it races with approval", async () => {
    const q = await begin(); const p = await prepare(q);
    const [decision, rejection] = await Promise.all([decide(q, p.pendingId), post("/api/mcp-auth/consents/reject", { oauthQuery: q })]);
    expect(rejection.status).toBe(200); expect([200, 409]).toContain(decision.status);
    const [pending] = await withUserLookupContext(db, owner.userId, (tx) => tx.select().from(mcpPendingConsents).where(eq(mcpPendingConsents.id, p.pendingId)));
    const [grant] = await owned(owner, (tx) => tx.select().from(mcpConnections).where(eq(mcpConnections.id, pending.connectionId)));
    expect(grant.status).toBe("revoked"); expect((await decide(q, p.pendingId)).status).toBe(409);
  });
  it("allows only grant owners to narrow scopes/selections and requires fresh consent for widening", async () => {
    const token = await connect(owner, ["shopping:read", "notes:read", "offline_access"], [ownNote]);
    const path = `/api/mcp-auth/connections/${token.connectionId}/narrow`;
    expect((await post(path, { scopes: ["shopping:read"], noteIds: [] }, colleague)).status).toBe(403);
    expect((await post(path, { scopes: ["chores:read"], noteIds: [] })).status).toBe(409);
    expect((await post(path, { scopes: ["notes:read"], noteIds: [foreignNote] })).status).toBe(409);
    expect((await post(path, { scopes: ["shopping:read", "offline_access"], noteIds: [] })).status).toBe(200);
    expect(await owned(owner, (tx) => tx.select().from(mcpNoteSelections).where(eq(mcpNoteSelections.connectionId, token.connectionId)))).toEqual([]);
    await expect(auth.mcp.authorize(bearer(token.access_token))).rejects.toMatchObject({ status: 401 });
    const response = await refresh(token.refresh_token, { scope: "shopping:read offline_access" });
    expect(response.status).toBe(200);
    expect(await auth.mcp.authorize(bearer((await response.json() as Tokens).access_token))).toMatchObject({ scopes: ["shopping:read", "offline_access"] });
    expect((await post(path, { scopes: ["shopping:read", "notes:read", "offline_access"], noteIds: [ownNote] })).status).toBe(409);
    await auth.mcp.revokeConnection(owner.headers, token.connectionId);
    expect((await post(path, { scopes: ["shopping:read"], noteIds: [] })).status).toBe(409);
  });
  it("hides a selected note's title after sharing is removed and permits immediate deselection", async () => {
    await owned(owner, (tx) => tx.insert(noteShares).values({ noteId: ownNote, memberId: colleague.memberId }));
    const token = await connect(colleague, ["notes:read", "offline_access"], [ownNote]);
    await owned(owner, (tx) => tx.delete(noteShares).where(and(eq(noteShares.noteId, ownNote), eq(noteShares.memberId, colleague.memberId))));
    const overview = await (await post("/api/mcp-auth/overview", { householdId: colleague.householdId }, colleague)).json() as { connections: { id: string; selectedNotes: { id: string; title: string | null }[] }[] };
    expect(overview.connections.find((c) => c.id === token.connectionId)?.selectedNotes).toEqual([{ id: ownNote, title: null }]);
    expect((await post(`/api/mcp-auth/connections/${token.connectionId}/narrow`, { scopes: ["notes:read", "offline_access"], noteIds: [] }, colleague)).status).toBe(200);
    expect(await owned(colleague, (tx) => tx.select().from(mcpNoteSelections).where(eq(mcpNoteSelections.connectionId, token.connectionId)))).toEqual([]);
  });
  it("tombstones background access so scoped-down refresh cannot restore it", async () => {
    const token = await connect();
    const response = await post(`/api/mcp-auth/connections/${token.connectionId}/narrow`, { scopes: ["shopping:read"], noteIds: [] });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ updated: true, revoked: true });
    await expect(auth.mcp.authorize(bearer(token.access_token))).rejects.toMatchObject({ status: 401 });
    expect((await refresh(token.refresh_token, { scope: "shopping:read" })).status).toBeGreaterThanOrEqual(400);
  });
  it("revokes immediately on membership and role changes, including after reinstatement", async () => {
    const token = await connect(colleague);
    await owned(owner, (tx) => tx.update(householdMembers).set({ accessRevokedAt: new Date() }).where(eq(householdMembers.id, colleague.memberId)));
    await expect(auth.mcp.authorize(bearer(token.access_token))).rejects.toMatchObject({ status: 401 });
    expect((await refresh(token.refresh_token)).status).toBeGreaterThanOrEqual(400);
    await owned(owner, (tx) => tx.update(householdMembers).set({ accessRevokedAt: null }).where(eq(householdMembers.id, colleague.memberId)));
    await expect(auth.mcp.authorize(bearer(token.access_token))).rejects.toMatchObject({ status: 401 });
    const changed = await connect(colleague);
    await owned(owner, (tx) => tx.update(householdMembers).set({ role: "admin" }).where(eq(householdMembers.id, colleague.memberId)));
    await expect(auth.mcp.authorize(bearer(changed.access_token))).rejects.toMatchObject({ status: 401 });
    await owned(owner, (tx) => tx.update(householdMembers).set({ role: "member" }).where(eq(householdMembers.id, colleague.memberId)));
  });
  it("does not resurrect connections after household opt-out and opt-in", async () => {
    const token = await connect(); await auth.mcp.setHouseholdEnabled(owner.headers, owner.householdId, false);
    await expect(auth.mcp.authorize(bearer(token.access_token))).rejects.toMatchObject({ status: 401 });
    await auth.mcp.setHouseholdEnabled(owner.headers, owner.householdId, true);
    await expect(auth.mcp.authorize(bearer(token.access_token))).rejects.toMatchObject({ status: 401 });
  });
  it("fails closed without tenant/identity scope, isolates households and restores pooled context", async () => {
    const a = await connect(); const b = await connect(stranger);
    expect(await db.select().from(mcpConnections)).toHaveLength(0);
    expect(await withWorkerScanContext(db, (tx) => tx.select().from(mcpConnections))).toHaveLength(0);
    expect(await withSystemContext(db, (tx) => tx.select().from(mcpConnections))).toHaveLength(0);
    expect(await owned(owner, (tx) => tx.select().from(mcpConnections).where(eq(mcpConnections.id, b.connectionId)))).toHaveLength(0);
    expect(await owned(colleague, (tx) => tx.select().from(mcpConnections).where(eq(mcpConnections.id, a.connectionId)))).toHaveLength(0);
    await expect(auth.mcp.revokeConnection(stranger.headers, a.connectionId)).rejects.toThrow();
    const [setting] = await db.execute<{ household: string | null; user: string | null; role: string }>(sql`select current_setting('app.current_household_id', true) as household, current_setting('app.current_user_id', true) as "user", current_user as role`);
    expect(setting.household || "").toBe(""); expect(setting.user || "").toBe(""); expect(setting.role).not.toBe("domi_ops_oauth");
    await expect(withMcpProviderContext(db, (tx) => tx.select().from(notes))).rejects.toThrow();
    expect(await db.select().from(oauthClient)).toHaveLength(0);
  });
  registerMcpAcceptanceCases(() => ({ db, auth, env, origin, cookiePrefix, owner, stranger, colleague, child, ownNote, foreignNote, connect, begin, post, owned, domainSnapshot, sideEffects }));
});
