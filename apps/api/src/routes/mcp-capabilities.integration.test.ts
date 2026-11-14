import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { createBetterAuth, MCP_POLICY_VERSION } from "@domi-ops/auth";
import { envSchema, mcpSupportedScopes, type Env } from "@domi-ops/config";
import {
  createDb, closeDb, householdMembers, households, users, householdSubscriptions, shoppingItems,
  mcpAccessEvents, mcpActionEvents, mcpConnectionCapabilities, oauthClient,
  withSystemContext, withUserLookupContext, withHouseholdContext, withMcpProviderContext, type Database,
} from "@domi-ops/db";
import { mcpAuthorizationRoutes } from "./mcp-authorization.js";
import { mcpGateway } from "../mcp/gateway.js";
import { readTools } from "../mcp/read-tools.js";
import { contextTool, type McpDirectTool } from "../mcp/tools.js";

const url = process.env.MCP_TEST_DATABASE_URL ?? process.env.HOSTED_TEST_DATABASE_URL;
// The migration owner's connection, used only to replay the 0108 backfill exactly as a migration would.
const adminUrl = process.env.MCP_TEST_ADMIN_DATABASE_URL;
const suite = url ? describe : describe.skip;
type Person = { userId: string; memberId: string; householdId: string; headers: Headers };
const scopes = ["shopping:read", "chores:read", "shopping:write", "offline_access"];
const SECRET_TITLE = "Fictional-secret-item";

for (const mode of ["single", "shared"] as const) suite(`MCP capabilities and direct actions (${mode}, restricted role)`, () => {
  let db: Database, auth: ReturnType<typeof createBetterAuth>, env: Env, server: ReturnType<typeof serve>, origin: string, clientId: string;
  let owner: Person, peer: Person, stranger: Person;
  let failAction = false;
  const householdIds: string[] = [], userIds: string[] = [], clientIds: string[] = [];
  const callback = "https://synthetic-assistant.example.test/capabilities", verifier = "c".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const input = z.object({ title: z.string().min(1).max(120) }).strict();
  // Fictional stand-in under the same name, used where a test needs to inject a failure into an action.
  const action: McpDirectTool = {
    name: "add_shopping_item", description: "Fictional direct action for tests.", scopes: ["shopping:write"], module: "core",
    access: "write", execution: "direct", capability: "shopping.add", input,
    output: z.object({ outcome: z.enum(["added", "already_on_list"]), id: z.uuid() }).strict(),
    async run(tx, identity, args) {
      const { title } = input.parse(args);
      const [existing] = await tx.select({ id: shoppingItems.id }).from(shoppingItems)
        .where(and(eq(shoppingItems.householdId, identity.householdId), eq(shoppingItems.item, title), eq(shoppingItems.checked, false)));
      if (existing) return { result: { outcome: "already_on_list", id: existing.id }, activity: { outcome: "already_on_list", targetId: existing.id } };
      const [row] = await tx.insert(shoppingItems).values({ householdId: identity.householdId, item: title }).returning({ id: shoppingItems.id });
      if (failAction) throw new Error("synthetic action failure");
      return { result: { outcome: "added", id: row.id }, activity: { outcome: "added", counts: { added: 1 }, targetId: row.id } };
    },
  };
  const gateway = (overrides: Partial<Env> = {}, tools = [contextTool, ...readTools(env), action]) => mcpGateway(db, auth.mcp, { ...env, ...overrides }, tools);

  async function owned<T>(person: Person, fn: (tx: Database) => Promise<T>) {
    return withUserLookupContext(db, person.userId, (lookup) => withHouseholdContext(lookup, person.householdId, fn));
  }
  async function post(path: string, body: unknown, person = owner) {
    return fetch(origin + path, { method: "POST", headers: person.headers, body: JSON.stringify(body) });
  }
  async function connect(person = owner, requested = scopes, capabilities?: string[]) {
    const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: callback, scope: requested.join(" "), resource: origin + "/api/mcp", state: randomUUID(), code_challenge: challenge, code_challenge_method: "S256" });
    const start = await fetch(origin + "/auth/oauth2/authorize?" + query, { headers: person.headers, redirect: "manual" });
    const location = start.headers.get("location") ?? (await start.json() as { url: string }).url;
    const oauthQuery = new URL(location, origin).searchParams.toString();
    const pending = await auth.mcp.prepareConsent(person.headers, { householdId: person.householdId, oauthQuery, noteIds: [], adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: MCP_POLICY_VERSION, ...(capabilities ? { capabilities } : {}) });
    const decided = await auth.mcp.decideConsent(person.headers, { pendingId: pending.pendingId, oauthQuery, accept: true });
    if (!decided.accepted) throw new Error("fictional consent denied");
    const code = new URL(decided.redirectUri).searchParams.get("code")!;
    const response = await fetch(origin + "/auth/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: callback, code, code_verifier: verifier, resource: origin + "/api/mcp" }) });
    expect(response.status).toBe(200);
    return { ...await response.json() as { access_token: string }, connectionId: decided.connectionId, capabilities: pending.capabilities };
  }
  let sequence = 0;
  async function rpc(token: string, method: string, params?: Record<string, unknown>, target = gateway()) {
    const response = await target.request(origin + "/api/mcp", { method: "POST",
      headers: { host: new URL(origin).host, authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, ...(params ? { params } : {}) }) });
    expect(response.status, await response.clone().text()).toBe(200);
    const text = await response.text();
    return JSON.parse(response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: "))!.slice(6) : text) as {
      error?: unknown; result: { tools?: { name: string; annotations?: Record<string, unknown> }[]; isError?: boolean; structuredContent?: Record<string, unknown>; content?: { text: string }[] } };
  }
  // An unlisted tool is a protocol error; a listed one that is refused reports isError.
  const refused = (response: Awaited<ReturnType<typeof rpc>>) => response.error !== undefined || response.result?.isError === true;
  const names = async (token: string, target = gateway()) => (await rpc(token, "tools/list", undefined, target)).result.tools!.map((tool) => tool.name);
  const call = (token: string, name: string, args: Record<string, unknown> = {}, target = gateway()) => rpc(token, "tools/call", { name, arguments: args }, target);
  const rows = (connectionId: string) => owned(owner, (tx) => tx.select().from(mcpConnectionCapabilities).where(eq(mcpConnectionCapabilities.connectionId, connectionId)));
  const items = (title: string) => owned(owner, (tx) => tx.select().from(shoppingItems).where(and(eq(shoppingItems.householdId, owner.householdId), eq(shoppingItems.item, title))));
  const setCapabilities = (connectionId: string, body: unknown, person = owner) => post(`/api/mcp-auth/connections/${connectionId}/capabilities`, body, person);

  beforeAll(async () => {
    db = createDb(url!);
    const [role] = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`);
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const app = new Hono();
    const tls = process.env.MCP_TEST_TLS_KEY_FILE ? { createServer, serverOptions: { key: readFileSync(process.env.MCP_TEST_TLS_KEY_FILE), cert: readFileSync(process.env.MCP_TEST_TLS_CERT_FILE!) } } : {};
    server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0, ...tls });
    await new Promise<void>((resolve) => server.listening ? resolve() : server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw Error("loopback required");
    origin = (process.env.MCP_TEST_TLS_KEY_FILE ? "https:" : "http:") + "//127.0.0.1:" + address.port;
    // Reviewed writes stay off throughout: direct actions must not depend on that switch.
    env = envSchema.parse({ NODE_ENV: "test", DEPLOYMENT_MODE: mode, PUBLIC_APP_URL: origin, API_URL: origin, DATABASE_URL: url,
      // Shared with the other MCP suites: they run against one database and one signing key.
      SESSION_SECRET: "synthetic-who469-session-secret-for-disposable-fixtures-only", MCP_ENABLED: "true", MCP_SYNTHETIC_DEPLOYMENT: "true",
      MCP_DIRECT_ACTIONS_ENABLED: "true", MCP_DIRECT_ACTIONS: "shopping.add", MODULES_ENABLED: "core" });
    auth = createBetterAuth(db, env, { cookiePrefix: "caps" + randomUUID().replaceAll("-", ""), deferHouseholdMembership: async () => true });
    app.all("/auth/*", (c) => auth.handler(c.req.raw));
    app.route("/api/mcp-auth", mcpAuthorizationRoutes(auth.mcp, env));
    for (let i = 0; i < 2; i++) {
      const [household] = await withSystemContext(db, (tx) => tx.insert(households).values({ name: "Fictional capability household", modulesEnabled: '["core"]' }).returning());
      householdIds.push(household.id);
    }
    const signup = async (householdId: string, role: "owner" | "member"): Promise<Person> => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      let response: Response;
      try { response = await fetch(origin + "/auth/sign-up/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Fictional Capability Member", email: randomUUID() + "@example.test", password: "Synthetic-only-capability-fixture-2026" }) }); }
      finally { warn.mockRestore(); }
      expect(response.status).toBe(200);
      const { user } = await response.json() as { user: { id: string } }; userIds.push(user.id);
      const [member] = await withSystemContext(db, (tx) => tx.insert(householdMembers).values({ householdId, userId: user.id, role }).returning());
      return { userId: user.id, memberId: member.id, householdId, headers: new Headers({ origin, "content-type": "application/json", cookie: response.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ") }) };
    };
    owner = await signup(householdIds[0], "owner"); peer = await signup(householdIds[0], "member"); stranger = await signup(householdIds[1], "owner");
    for (const person of [owner, stranger]) {
      await auth.mcp.setHouseholdEnabled(person.headers, person.householdId, true);
      await owned(person, (tx) => tx.insert(householdSubscriptions).values({ householdId: person.householdId, modulesEntitled: '["core"]', status: "active" }));
    }
    const client = await auth.mcp.registerClient(owner.headers, { name: "Fictional capability client", redirectUris: [callback], tokenEndpointAuthMethod: "none", scopes, provider: "local", profileVersion: "capabilities.fixture.v1", dataMode: "synthetic", enabled: true });
    clientId = client.client_id; clientIds.push(clientId);
  }, 30000);
  afterAll(async () => {
    if (db) {
      await withSystemContext(db, async (tx) => {
        if (householdIds.length) await tx.delete(households).where(inArray(households.id, householdIds));
        if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
      });
      await withMcpProviderContext(db, async (tx) => { if (clientIds.length) await tx.delete(oauthClient).where(inArray(oauthClient.clientId, clientIds)); });
      await closeDb(db);
    }
    await new Promise<void>((resolve, reject) => server ? server.close((error) => error ? reject(error) : resolve()) : resolve());
  });

  it("keeps the two write switches independent and rejects an invalid tool registry", () => {
    expect(env.MCP_WRITES_ENABLED).toBe(false);
    expect(mcpSupportedScopes(env)).toEqual(["shopping:read", "chores:read", "notes:read", "shopping:write", "offline_access"]);
    expect(mcpSupportedScopes({ ...env, MCP_DIRECT_ACTIONS_ENABLED: false })).not.toContain("shopping:write");
    expect(() => gateway({}, [contextTool, { ...action, access: "read" } as never])).toThrow("Invalid MCP tool registry");
    expect(() => gateway({}, [contextTool, { ...contextTool, name: "list_chores", access: "write" } as never])).toThrow("Invalid MCP tool registry");
    expect(() => gateway({}, [contextTool, { ...contextTool, name: "list_chores", execution: "direct" } as never])).toThrow("Invalid MCP tool registry");
    expect(() => mcpGateway(db, auth.mcp, env)).not.toThrow();
  });

  it("defaults a new connection to its requested reads and never to an action", async () => {
    const token = await connect();
    expect(token.capabilities).toEqual(["shopping.read", "chores.read"]);
    expect((await rows(token.connectionId)).map((row) => row.capability).sort()).toEqual(["chores.read", "shopping.read"]);
    expect(await names(token.access_token)).toEqual(["get_connection_context", "list_shopping_items", "list_chores"]);
    const denied = await call(token.access_token, "add_shopping_item", { title: "Fictional oats" });
    expect(refused(denied), JSON.stringify(denied)).toBe(true);
    expect(await items("Fictional oats")).toEqual([]);
    const production = mcpGateway(db, auth.mcp, env);
    expect(await names(token.access_token, production)).toEqual(["get_connection_context", "list_shopping_items", "list_chores"]);
  });

  it("lets the member untick a requested read at consent and reports only active scopes", async () => {
    const token = await connect(owner, scopes, ["shopping.read"]);
    expect(await names(token.access_token)).toEqual(["get_connection_context", "list_shopping_items"]);
    const context = await call(token.access_token, "get_connection_context");
    expect(context.result.structuredContent).toMatchObject({ capabilities: ["shopping:read"], tools: ["get_connection_context", "list_shopping_items"] });
    const chores = await call(token.access_token, "list_chores");
    expect(refused(chores), JSON.stringify(chores)).toBe(true);
  });

  it("rejects capabilities outside the requested scopes or the operator ceiling", async () => {
    await expect(connect(owner, ["shopping:read", "offline_access"], ["chores.read"])).rejects.toMatchObject({ code: "invalid_capability" });
    await expect(connect(owner, ["shopping:read", "offline_access"], ["shopping.add"])).rejects.toMatchObject({ code: "invalid_capability" });
    await expect(connect(owner, scopes, ["shopping.read", "shopping.read"])).rejects.toMatchObject({ code: "invalid_capability" });
    await expect(connect(owner, scopes, ["health.groups.log"])).rejects.toMatchObject({ code: "invalid_capability" });
  });

  it("requires acknowledgment and the grant owner's session to switch an action on, and applies it on the next call", async () => {
    const token = await connect();
    expect((await setCapabilities(token.connectionId, { capabilities: ["shopping.read", "chores.read", "shopping.add"] })).status).toBe(400);
    expect((await setCapabilities(token.connectionId, { capabilities: ["shopping.read", "shopping.add"], acknowledged: true }, peer)).status).toBe(403);
    expect((await setCapabilities(token.connectionId, { capabilities: ["shopping.add"], acknowledged: true }, stranger)).status).toBe(403);
    expect((await setCapabilities(token.connectionId, { capabilities: ["notes.read"], acknowledged: true })).status).toBe(400);
    expect(await names(token.access_token)).not.toContain("add_shopping_item");
    const enabled = await setCapabilities(token.connectionId, { capabilities: ["shopping.read", "chores.read", "shopping.add"], acknowledged: true });
    expect(enabled.status, await enabled.clone().text()).toBe(200);
    expect(await enabled.json()).toMatchObject({ added: ["shopping.add"], removed: [] });
    const listed = (await rpc(token.access_token, "tools/list")).result.tools!;
    expect(listed.map((tool) => tool.name)).toEqual(["get_connection_context", "list_shopping_items", "list_chores", "add_shopping_item"]);
    expect(listed.find((tool) => tool.name === "add_shopping_item")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(listed.find((tool) => tool.name === "list_chores")!.annotations).toMatchObject({ readOnlyHint: true });
    // Turning something off needs no acknowledgment and is immediate.
    const disabled = await setCapabilities(token.connectionId, { capabilities: ["shopping.read", "shopping.add"] });
    expect(await disabled.json()).toMatchObject({ added: [], removed: ["chores.read"] });
    expect(await names(token.access_token)).toEqual(["get_connection_context", "list_shopping_items", "add_shopping_item"]);
  });

  it("runs a direct action in chat, is safe to repeat and records activity without content", async () => {
    const token = await connect(owner, scopes, ["shopping.read", "shopping.add"]);
    const first = await call(token.access_token, "add_shopping_item", { title: SECRET_TITLE });
    expect(first.result.isError, JSON.stringify(first)).not.toBe(true);
    expect(first.result.structuredContent).toMatchObject({ outcome: "added" });
    const second = await call(token.access_token, "add_shopping_item", { title: SECRET_TITLE });
    expect(second.result.structuredContent).toMatchObject({ outcome: "already_on_list", id: first.result.structuredContent!.id });
    expect(await items(SECRET_TITLE)).toHaveLength(1);
    const events = await owned(owner, (tx) => tx.select().from(mcpActionEvents).where(eq(mcpActionEvents.connectionId, token.connectionId)));
    expect(events.map((event) => event.outcome).sort()).toEqual(["added", "already_on_list"]);
    expect(events.every((event) => event.action === "shopping.add")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(SECRET_TITLE);
    // Another member, even an admin of the same household, cannot read this connection's activity.
    expect(await owned(peer, (tx) => tx.select().from(mcpActionEvents).where(eq(mcpActionEvents.connectionId, token.connectionId)))).toEqual([]);
  });

  it("saves nothing and says so when an action fails inside its transaction", async () => {
    const token = await connect(owner, scopes, ["shopping.add"]);
    failAction = true;
    try {
      const failed = await call(token.access_token, "add_shopping_item", { title: "Fictional rollback item" });
      expect(failed.result.isError).toBe(true);
      expect(failed.result.content![0].text).toContain("Nothing was saved");
      expect(failed.result.content![0].text).not.toContain("synthetic action failure");
    } finally { failAction = false; }
    expect(await items("Fictional rollback item")).toEqual([]);
    expect(await owned(owner, (tx) => tx.select().from(mcpActionEvents).where(eq(mcpActionEvents.connectionId, token.connectionId)))).toEqual([]);
  });

  it("stops an action when the member, operator, subscription or scope no longer allows it", async () => {
    const token = await connect(owner, scopes, ["shopping.read", "shopping.add"]);
    const blocked = async (title: string, target = gateway()) => {
      const result = await call(token.access_token, "add_shopping_item", { title }, target);
      expect(refused(result), JSON.stringify(result)).toBe(true);
      expect(await items(title)).toEqual([]);
    };
    // Operator ceiling. Reviewed writes being on must not admit a direct action.
    expect(await names(token.access_token, gateway({ MCP_DIRECT_ACTIONS_ENABLED: false, MCP_WRITES_ENABLED: true, MCP_WRITE_SCOPES: ["shopping:write"] }))).not.toContain("add_shopping_item");
    await blocked("Fictional ceiling item", gateway({ MCP_DIRECT_ACTIONS_ENABLED: false, MCP_WRITES_ENABLED: true, MCP_WRITE_SCOPES: ["shopping:write"] }));
    if (mode === "shared") {
      await owned(owner, (tx) => tx.update(householdSubscriptions).set({ status: "canceled" }).where(eq(householdSubscriptions.householdId, owner.householdId)));
      try {
        // A read-only subscription keeps its reads and loses actions.
        expect(await names(token.access_token)).toEqual(["get_connection_context", "list_shopping_items"]);
        await blocked("Fictional canceled item");
      } finally { await owned(owner, (tx) => tx.update(householdSubscriptions).set({ status: "active" }).where(eq(householdSubscriptions.householdId, owner.householdId))); }
    }
    // Member switch.
    await setCapabilities(token.connectionId, { capabilities: ["shopping.read"] });
    await blocked("Fictional disabled item");
    // Narrowing a scope away removes the capability it bounded and cannot be undone in place.
    await setCapabilities(token.connectionId, { capabilities: ["shopping.read", "shopping.add"], acknowledged: true });
    const narrowed = await post(`/api/mcp-auth/connections/${token.connectionId}/narrow`, { scopes: ["shopping:read", "offline_access"], noteIds: [] });
    expect(narrowed.status, await narrowed.clone().text()).toBe(200);
    expect((await rows(token.connectionId)).map((row) => row.capability)).toEqual(["shopping.read"]);
    expect((await setCapabilities(token.connectionId, { capabilities: ["shopping.read", "shopping.add"], acknowledged: true })).status).toBe(400);
  });

  it("saves ten actions inside a minute and refuses the eleventh with an explicit rate-limit outcome", async () => {
    const token = await connect(owner, scopes, ["shopping.read", "shopping.add"]);
    const title = (n: number) => `Fictional budget item ${n} ${token.connectionId.slice(0, 8)}`;
    const actions = () => owned(owner, (tx) => tx.select().from(mcpActionEvents).where(eq(mcpActionEvents.connectionId, token.connectionId)));
    const seed = (count: number, secondsAgo: number) => owned(owner, (tx) => tx.insert(mcpActionEvents).values(Array.from({ length: count }, () => ({
      householdId: owner.householdId, userId: owner.userId, connectionId: token.connectionId, action: "shopping.add", outcome: "added", createdAt: new Date(Date.now() - secondsAgo * 1000) }))));
    // Eight actions twenty seconds ago, and one that is already outside the rolling minute and must not count.
    await seed(8, 20); await seed(1, 75);
    for (const n of [9, 10]) {
      const saved = await call(token.access_token, "add_shopping_item", { title: title(n) });
      expect(saved.result.isError, JSON.stringify(saved)).not.toBe(true);
      expect(saved.result.structuredContent).toMatchObject({ outcome: "added" });
    }
    expect(await actions()).toHaveLength(11);

    const eleventh = await call(token.access_token, "add_shopping_item", { title: title(11) });
    expect(eleventh.error).toBeUndefined();
    expect(eleventh.result.isError).toBe(true);
    expect(eleventh.result.structuredContent).toBeUndefined();
    expect(eleventh.result.content).toHaveLength(1);
    const text = eleventh.result.content![0].text;
    const match = /^rate_limited: Nothing was saved\. This connection has reached its limit of 10 actions per minute\. Do not retry automatically\. Tell the user the action limit was reached and that they can ask again in about (\d+) seconds?\.$/.exec(text);
    expect(match, text).not.toBeNull();
    // The oldest counted action is about twenty seconds old, so the window frees up in about forty.
    expect(Number(match![1])).toBeGreaterThanOrEqual(30);
    expect(Number(match![1])).toBeLessThanOrEqual(41);
    // Nothing about the request, the caller or the server's internals is in the refusal.
    const raw = JSON.stringify(eleventh);
    for (const hidden of [title(11), "Fictional budget", token.connectionId, owner.householdId, owner.userId, token.access_token, "McpActionRateLimitError", "429", "mcp_action_events", "stack"]) expect(raw, hidden).not.toContain(hidden);
    expect(await items(title(11))).toEqual([]);
    expect(await actions()).toHaveLength(11);
    const audit = await owned(owner, (tx) => tx.select().from(mcpAccessEvents).where(eq(mcpAccessEvents.connectionId, token.connectionId)));
    expect(audit.filter((event) => event.outcome === "action_rate_limited").map((event) => event.tool)).toEqual(["add_shopping_item"]);
    expect(JSON.stringify(audit)).not.toContain("Fictional budget");

    // Asking again straight away is refused again and still saves nothing: the server never retries or queues.
    const again = await call(token.access_token, "add_shopping_item", { title: title(11) });
    expect(again.result.content![0].text).toMatch(/^rate_limited: Nothing was saved\./);
    expect(await items(title(11))).toEqual([]);
    expect(await actions()).toHaveLength(11);
    // Only actions are bounded here. Reads on the same connection go on working.
    expect((await call(token.access_token, "list_shopping_items", { checked: "open", limit: 1 })).result.isError).not.toBe(true);
    // Every other refusal keeps its generic wording and is never described as a rate limit.
    const switchedOff = await call(token.access_token, "add_shopping_item", { title: title(14) }, gateway({ MCP_DIRECT_ACTIONS_ENABLED: false }));
    expect(refused(switchedOff)).toBe(true);
    expect(JSON.stringify(switchedOff)).not.toContain("rate_limited");

    // Once the counted actions are a minute old the same request goes through.
    await owned(owner, (tx) => tx.update(mcpActionEvents).set({ createdAt: new Date(Date.now() - 61_000) }).where(eq(mcpActionEvents.connectionId, token.connectionId)));
    const later = await call(token.access_token, "add_shopping_item", { title: title(11) });
    expect(later.result.structuredContent, JSON.stringify(later)).toMatchObject({ outcome: "added" });
    expect(await items(title(11))).toHaveLength(1);
    failAction = true;
    try {
      const failed = await call(token.access_token, "add_shopping_item", { title: title(13) });
      expect(failed.result.isError).toBe(true);
      expect(failed.result.content![0].text).toBe("Nothing was saved. The action is unavailable or could not be completed. Repeating the same request is safe.");
    } finally { failAction = false; }

    // The limit belongs to one connection. With this one's budget spent again, a fresh grant starts with its own.
    await seed(10, 5);
    expect((await call(token.access_token, "add_shopping_item", { title: title(12) })).result.content![0].text).toMatch(/^rate_limited: /);
    const fresh = await connect(owner, scopes, ["shopping.add"]);
    expect(fresh.connectionId).not.toBe(token.connectionId);
    expect((await call(fresh.access_token, "add_shopping_item", { title: title(12) })).result.structuredContent).toMatchObject({ outcome: "added" });
  });

  it("counts exactly ten real actions before refusing", async () => {
    const token = await connect(owner, scopes, ["shopping.add"]);
    const title = (n: number) => `Fictional burst item ${n} ${token.connectionId.slice(0, 8)}`;
    for (let n = 1; n <= 10; n++) {
      const saved = await call(token.access_token, "add_shopping_item", { title: title(n) });
      expect(saved.result.structuredContent, `add ${n}: ${JSON.stringify(saved)}`).toMatchObject({ outcome: "added" });
    }
    const eleventh = await call(token.access_token, "add_shopping_item", { title: title(11) });
    expect(eleventh.result.isError).toBe(true);
    expect(eleventh.result.content![0].text).toMatch(/^rate_limited: Nothing was saved\. This connection has reached its limit of 10 actions per minute\./);
    for (let n = 1; n <= 10; n++) expect(await items(title(n)), `item ${n}`).toHaveLength(1);
    expect(await items(title(11))).toEqual([]);
    expect(await owned(owner, (tx) => tx.select().from(mcpActionEvents).where(eq(mcpActionEvents.connectionId, token.connectionId)))).toHaveLength(10);
  });

  it("previews the exact read payload for the member's own data without a grant or side effects", async () => {
    const title = "Fictional preview item " + randomUUID();
    await owned(owner, (tx) => tx.insert(shoppingItems).values({ householdId: owner.householdId, item: title, notes: "Fictional private note", cost: 4.5 }));
    const response = await post("/api/mcp-auth/capabilities/preview", { householdId: owner.householdId, capability: "shopping.read" });
    expect(response.status, await response.clone().text()).toBe(200);
    const preview = await response.json() as { tool: string; payload: { data: Record<string, unknown>[]; contentTrust: string } };
    expect(preview.tool).toBe("list_shopping_items");
    expect(preview.payload.contentTrust).toBe("untrusted");
    expect(preview.payload.data.length).toBeLessThanOrEqual(3);
    // Same field list as the tool: no notes or cost, whatever the record holds.
    for (const row of preview.payload.data) expect(Object.keys(row).sort()).toEqual(["aisle", "appLink", "checked", "fieldsTruncated", "id", "quantity", "title", "unit"]);
    expect(JSON.stringify(preview)).not.toContain("Fictional private note");
    expect((await post("/api/mcp-auth/capabilities/preview", { householdId: owner.householdId, capability: "chores.read" })).status).toBe(200);
    expect((await post("/api/mcp-auth/capabilities/preview", { householdId: owner.householdId, capability: "notes.read" })).status).toBe(400);
    expect((await post("/api/mcp-auth/capabilities/preview", { householdId: owner.householdId, capability: "shopping.add" })).status).toBe(400);
    // Another household's id is refused, and a signed-out caller gets nothing.
    expect((await post("/api/mcp-auth/capabilities/preview", { householdId: stranger.householdId, capability: "shopping.read" })).status).toBe(403);
    const anonymous = await fetch(origin + "/api/mcp-auth/capabilities/preview", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ householdId: owner.householdId, capability: "shopping.read" }) });
    expect(anonymous.status).toBe(401);
  });

  it("adds a shopping item through the production tool with only a name, quantity and unit", async () => {
    const token = await connect(owner, scopes, ["shopping.read", "shopping.add"]);
    const production = mcpGateway(db, auth.mcp, env);
    expect(await names(token.access_token, production)).toEqual(["get_connection_context", "list_shopping_items", "add_shopping_item"]);
    const name = "Fictional Oat Milk " + randomUUID().slice(0, 8);
    const added = await call(token.access_token, "add_shopping_item", { title: "  " + name.replace(" Oat ", "   Oat  ") + " ", quantity: 2, unit: " cartons " }, production);
    expect(added.result.isError, JSON.stringify(added)).not.toBe(true);
    expect(added.result.structuredContent).toMatchObject({ outcome: "added", item: { title: name, quantity: 2, unit: "cartons" } });
    const [row] = await items(name);
    // Nothing beyond the three accepted fields is written, and the household can see who it came from.
    expect(row).toMatchObject({ item: name, quantity: 2, unit: "cartons", checked: false, notes: null, cost: null, recurringId: null, tagsJson: "[]" });
    expect(row.createdByDisplayName).toMatch(/Fictional capability client$/);
    // Same name in a different case and spacing is the same item; a retry cannot duplicate it.
    const repeat = await call(token.access_token, "add_shopping_item", { title: name.toUpperCase() }, production);
    expect(repeat.result.structuredContent).toMatchObject({ outcome: "already_on_list", item: { id: row.id, title: name, quantity: 2, unit: "cartons" } });
    expect(await items(name)).toHaveLength(1);
    // The connection's own read sees it.
    const listed = await call(token.access_token, "list_shopping_items", { limit: 50 }, production);
    expect(JSON.stringify(listed.result.structuredContent)).toContain(row.id);
    // Once it is checked off, asking again is a new purchase.
    await owned(owner, (tx) => tx.update(shoppingItems).set({ checked: true }).where(eq(shoppingItems.id, row.id)));
    const again = await call(token.access_token, "add_shopping_item", { title: name }, production);
    expect(again.result.structuredContent).toMatchObject({ outcome: "added", item: { quantity: null, unit: null } });
    expect(await items(name)).toHaveLength(2);
    // The other household is untouched.
    expect(await owned(stranger, (tx) => tx.select().from(shoppingItems).where(eq(shoppingItems.householdId, stranger.householdId)))).toEqual([]);
    const events = await owned(owner, (tx) => tx.select().from(mcpActionEvents).where(eq(mcpActionEvents.connectionId, token.connectionId)));
    expect(events.map((event) => event.outcome).sort()).toEqual(["added", "added", "already_on_list"]);
    expect(JSON.stringify(events)).not.toContain("Oat");
  });

  it("refuses anything but a clean single-line name and writes nothing", async () => {
    const token = await connect(owner, scopes, ["shopping.add"]);
    const production = mcpGateway(db, auth.mcp, env);
    const before = (await owned(owner, (tx) => tx.select({ id: shoppingItems.id }).from(shoppingItems).where(eq(shoppingItems.householdId, owner.householdId)))).length;
    for (const args of [{}, { title: "" }, { title: "   " }, { title: "Fictional two\nlines" }, { title: "Fictional\ttab" }, { title: "Fictional \u202Ereversed" }, { title: "x".repeat(121) },
      { title: "Fictional notes", notes: "Fictional private note" }, { title: "Fictional cost", cost: 3 }, { title: "Fictional tags", tags: ["a"] }, { title: "Fictional checked", checked: true },
      { title: "Fictional household", householdId: stranger.householdId }, { title: "Fictional zero", quantity: 0 }, { title: "Fictional huge", quantity: 10000 }, { title: "Fictional unit", unit: "u".repeat(33) }]) {
      const result = await call(token.access_token, "add_shopping_item", args, production);
      expect(refused(result), JSON.stringify(args)).toBe(true);
    }
    expect((await owned(owner, (tx) => tx.select({ id: shoppingItems.id }).from(shoppingItems).where(eq(shoppingItems.householdId, owner.householdId)))).length).toBe(before);
    expect(await owned(owner, (tx) => tx.select().from(mcpActionEvents).where(eq(mcpActionEvents.connectionId, token.connectionId)))).toEqual([]);
  });

  it("adds one row when the same item is requested twice at once", async () => {
    const token = await connect(owner, scopes, ["shopping.add"]);
    const production = mcpGateway(db, auth.mcp, env), name = "Fictional concurrent " + randomUUID().slice(0, 8);
    const results = await Promise.all([call(token.access_token, "add_shopping_item", { title: name }, production), call(token.access_token, "add_shopping_item", { title: name }, production)]);
    expect(results.map((result) => result.result.structuredContent?.outcome).sort()).toEqual(["added", "already_on_list"]);
    expect(await items(name)).toHaveLength(1);
  });

  it.skipIf(!adminUrl)("backfills an existing grant with the reads it holds and no action", async () => {
    const token = await connect(owner, scopes, ["shopping.read", "chores.read", "shopping.add"]);
    const revoked = await connect(owner, scopes, ["shopping.read"]);
    // `revoked` replaced `token` for this client, so `token` is now a revoked grant and `revoked` the live one.
    const live = revoked.connectionId, old = token.connectionId;
    await owned(owner, (tx) => tx.delete(mcpConnectionCapabilities).where(inArray(mcpConnectionCapabilities.connectionId, [live, old])));
    expect(await names(revoked.access_token)).toEqual(["get_connection_context"]);
    const migration = readFileSync(new URL("../../../../packages/db/drizzle/0108_mcp_capabilities.sql", import.meta.url), "utf8");
    const start = migration.indexOf("INSERT INTO mcp_connection_capabilities"), statement = migration.slice(start, migration.indexOf(";", start) + 1);
    expect(statement).toContain("ON CONFLICT");
    const admin = createDb(adminUrl!);
    try {
      await admin.execute(sql.raw(statement));
      // Running it again changes nothing.
      await admin.execute(sql.raw(statement));
    } finally { await closeDb(admin); }
    const restored = await rows(live);
    // The grant holds shopping:write, yet the backfill never switches an action on.
    expect(restored.map((row) => row.capability).sort()).toEqual(["chores.read", "shopping.read"]);
    expect(restored.every((row) => row.consentVersion === "backfill.0108")).toBe(true);
    expect(await rows(old)).toEqual([]);
    expect(await names(revoked.access_token)).toEqual(["get_connection_context", "list_shopping_items", "list_chores"]);
  });

  it("shows capabilities only to the connection's own member", async () => {
    const token = await connect(owner, scopes, ["shopping.read", "shopping.add"]);
    const overview = await (await post("/api/mcp-auth/overview", { householdId: owner.householdId })).json() as { connections: { id: string; capabilities: string[]; availableCapabilities: unknown[]; recentActions: Record<string, unknown>[] }[] };
    await call(token.access_token, "add_shopping_item", { title: SECRET_TITLE + "-overview" });
    const mine = async () => (await (await post("/api/mcp-auth/overview", { householdId: owner.householdId })).json() as typeof overview).connections.find((c) => c.id === token.connectionId)!;
    expect(overview.connections.find((c) => c.id === token.connectionId)).toMatchObject({ capabilities: ["shopping.add", "shopping.read"], recentActions: [],
      availableCapabilities: [{ name: "shopping.read", access: "read" }, { name: "chores.read", access: "read" }, { name: "shopping.add", access: "write" }] });
    const after = await mine();
    expect(after.recentActions).toHaveLength(1);
    expect(after.recentActions[0]).toMatchObject({ action: "shopping.add", outcome: "added", counts: { added: 1 } });
    expect(Object.keys(after.recentActions[0]).sort()).toEqual(["action", "counts", "createdAt", "outcome"]);
    expect(JSON.stringify(after)).not.toContain(SECRET_TITLE);
    const other = await (await post("/api/mcp-auth/overview", { householdId: peer.householdId }, peer)).json() as { connections: unknown[] };
    expect(other.connections).toEqual([]);
    expect(await owned(peer, (tx) => tx.select().from(mcpConnectionCapabilities).where(eq(mcpConnectionCapabilities.connectionId, token.connectionId)))).toEqual([]);
  });
});
