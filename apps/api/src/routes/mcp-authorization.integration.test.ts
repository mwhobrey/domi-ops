import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { createServer as createHttpsServer } from "node:https";
import { decodeJwt, decodeProtectedHeader, importJWK, SignJWT, generateKeyPair, exportJWK } from "jose";
import { symmetricDecrypt } from "better-auth/crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createBetterAuth, MCP_POLICY_VERSION, CLAUDE_CLIENT_ID, CLAUDE_CALLBACK, CHATGPT_CLIENT_ID, CHATGPT_CALLBACK, CHATGPT_JWKS_URI, GROK_BOT_CLIENT_ID, GROK_BOT_CALLBACK, GROK_BOT_METADATA_CALLBACKS } from "@domi-ops/auth";
import { planMcpClient, provisionMcpClient } from "@domi-ops/auth/mcp-client-provisioning";
import { envSchema, type Env } from "@domi-ops/config";
import {
  createDb, closeDb, households, householdMembers, users, notes, mcpConnections, mcpPendingConsents,
  mcpNoteSelections, mcpClientProfiles, noteShares, oauthClient, oauthRefreshToken, jwks, withHouseholdContext, withUserLookupContext,
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
import { shoppingItems, shoppingRecurring, chores, choresRecurring, pushSubscriptions } from "@domi-ops/db";
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
  async function begin(person = owner, requestedScopes = ["shopping:read", "offline_access"], requestedClientId = clientId, requestedCallback = callback) {
    const params = new URLSearchParams({ response_type: "code", client_id: requestedClientId, redirect_uri: requestedCallback,
      scope: requestedScopes.join(" "), resource: origin + "/api/mcp", state: randomUUID(),
      code_challenge: challenge, code_challenge_method: "S256" });
    const response = await fetch(origin + "/auth/oauth2/authorize?" + params, { headers: person.headers, redirect: "manual" });
    const data = response.headers.has("location") ? null : await response.json() as { url?: string };
    const location = response.headers.get("location") ?? data?.url;
    if (typeof location !== "string") throw new Error("Fictional authorization failed: " + JSON.stringify(data));
    expect(new URL(location, origin).pathname).toBe("/ai/consent");
    return new URL(location, origin).searchParams.toString();
  }
  async function prepare(query: string, person = owner, noteIds: string[] = []) {
    const response = await post("/api/mcp-auth/consents/prepare", { householdId: person.householdId, oauthQuery: query, noteIds,
      adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: MCP_POLICY_VERSION }, person);
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
        // Push subscriptions are global; parallel suites own different users' subscriptions.
        const filter = table === "push_subscriptions" ? sql`where ${inArray(sql`t.user_id`, userIds)}` : sql``;
        const [row] = await tx.execute(sql`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as data from ${sql.identifier(table)} t ${filter}`);
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

  it("operator provisioning requires HTTPS and a real session, without creating a member grant", async () => {
    const config = { origin, name: "Fictional operator registration", provider: "claude", profileVersion: "pilot.claude.fixture.v1",
      redirectUri: "https://claude.ai/api/mcp/auth_callback", scopes: ["shopping:read", "offline_access"] };
    // The broad hosted fixture uses HTTP loopback; production provisioning must
    // refuse it. The dedicated HTTPS matrix exercises registration in both modes.
    if (new URL(origin).protocol === "http:") {
      expect(() => planMcpClient(config, origin)).toThrow("canonical_origin_mismatch");
      return;
    }
    const plan = planMcpClient(config, origin);
    const root = await mkdtemp(join(tmpdir(), "domi-mcp-operator-fixture-"));
    const cookieFile = join(root, "session.private");
    const before = await owned(owner, (tx) => tx.select().from(mcpConnections));
    try {
      await writeFile(cookieFile, "invalid_session=fictional", { mode: 0o600 });
      await expect(provisionMcpClient(plan, { confirmPlan: plan.sha256, cookieFile, receiptFile: join(root, "denied.json"),
        register: (headers, input) => auth.mcp.registerClient(headers, input) })).rejects.toThrow("registration_uncertain_inspect_receipt");
      await writeFile(cookieFile, owner.headers.get("cookie")!);
      const receiptFile = join(root, "registered.json");
      const result = await provisionMcpClient(plan, { confirmPlan: plan.sha256, cookieFile, receiptFile,
        register: (headers, input) => auth.mcp.registerClient(headers, input) });
      clientIds.push(result.clientId);
      const [profile] = await withMcpProviderContext(db, (tx) => tx.select().from(mcpClientProfiles).where(eq(mcpClientProfiles.clientId, result.clientId)));
      expect(profile).toMatchObject({ provider: "claude", dataMode: "household", enabled: false, version: "pilot.claude.fixture.v1" });
      expect(await owned(owner, (tx) => tx.select().from(mcpConnections))).toEqual(before);
      expect(await readFile(receiptFile, "utf8")).not.toContain(owner.headers.get("cookie")!);
    } finally {
      expect(dirname(root)).toBe(resolve(tmpdir())); expect(basename(root)).toMatch(/^domi-mcp-operator-fixture-/);
      await rm(root, { recursive: true, force: true });
    }
  });
  it("serves protected-resource discovery and bearer challenges without browser cookie fallback", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
      const response = await fetch(origin + path);
      expect(await response.json()).toEqual({ resource: origin + "/api/mcp", authorization_servers: [origin + "/auth"], bearer_methods_supported: ["header"], scopes_supported: scopes });
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
  it.each([
    ["claude", ["shopping:read", "chores:read"]], ["chatgpt", ["shopping:read", "chores:read"]],
    ["grok-bot", ["shopping:read", "chores:read"]], ["grok-bot", ["shopping:read"]], ["grok-bot", ["chores:read"]],
  ] as const)("onboards %s with %j without registration and preserves consent, isolation, refresh and disable gates", async (providerName, readScopes) => {
    const originalAuth = auth;
    const chatgpt = providerName === "chatgpt", grokBot = providerName === "grok-bot";
    const id = grokBot ? GROK_BOT_CLIENT_ID : chatgpt ? CHATGPT_CLIENT_ID : CLAUDE_CLIENT_ID;
    const redirect = grokBot ? GROK_BOT_CALLBACK : chatgpt ? CHATGPT_CALLBACK : CLAUDE_CALLBACK;
    const limitedEnv: Env = { ...env, MCP_CLAUDE_ENABLED: true, MCP_CHATGPT_ENABLED: true, MCP_GROK_BOT_ENABLED: true, MCP_READ_SCOPES: [...readScopes] };
    const keys = await generateKeyPair("RS256"), kid = randomUUID();
    const metadata = { client_id: id, client_name: grokBot ? "Cursor" : chatgpt ? "ChatGPT" : "Claude", client_uri: grokBot ? "https://cursor.com" : chatgpt ? "https://chatgpt.com/" : "https://claude.ai",
      redirect_uris: grokBot ? [...GROK_BOT_METADATA_CALLBACKS] : [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: chatgpt ? "private_key_jwt" : "none",
      ...(chatgpt ? { token_endpoint_auth_methods_supported: ["none", "private_key_jwt"], jwks_uri: CHATGPT_JWKS_URI } : {}) };
    const transport = vi.fn(async (input: string | Request | URL) => {
      if (String(input) === CHATGPT_JWKS_URI) return Response.json({ keys: [{ ...await exportJWK(keys.publicKey), kid, alg: "RS256", use: "sig" }] }, { headers: { "cache-control": "no-store" } });
      if (String(input) !== id) throw new Error("Unexpected metadata fetch");
      return Response.json(metadata, { headers: { "cache-control": "no-store" } });
    });
    async function assertion(audience = origin + "/auth/oauth2/token") {
      return { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion:
        await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid }).setIssuer(id).setSubject(id).setAudience(audience)
          .setIssuedAt().setExpirationTime("60s").setJti(randomUUID()).sign(keys.privateKey) };
    }
    async function refreshClient(token: string) { return refresh(token, { client_id: id, ...(chatgpt ? await assertion() : {}) }); }
    const limited = createBetterAuth(db, limitedEnv, { cookiePrefix, mcpMetadataFetch: transport });
    auth = limited;
    clientIds.push(id);
    try {
      const issuer = z.object({ scopes_supported: z.array(z.string()), token_endpoint_auth_methods_supported: z.array(z.string()),
        issuer: z.string(), authorization_response_iss_parameter_supported: z.boolean(),
        client_id_metadata_document_supported: z.boolean(), registration_endpoint: z.string().optional() }).parse(
        await (await limited.mcp.metadata(new Request(origin + "/.well-known/oauth-authorization-server/auth"))).json());
      expect(issuer).toMatchObject({ client_id_metadata_document_supported: true });
      expect(issuer).toMatchObject({ issuer: origin + "/auth", authorization_response_iss_parameter_supported: true });
      expect(issuer.token_endpoint_auth_methods_supported).toContain("none");
      expect(issuer.registration_endpoint).toBeUndefined();
      if (chatgpt) expect(issuer.token_endpoint_auth_methods_supported).toContain("private_key_jwt");
      const overview = await limited.mcp.overview(owner.headers, owner.householdId);
      expect(overview.claude?.serverUrl).toBe(origin + "/api/mcp");
      expect(new URL(overview.claude!.connectUrl).searchParams.get("connectorUrl")).toBe(origin + "/api/mcp");
      expect((await originalAuth.mcp.overview(owner.headers, owner.householdId)).claude).toBeNull();
      expect(overview.chatgpt?.serverUrl).toBe(origin + "/api/mcp");
      expect((await originalAuth.mcp.overview(owner.headers, owner.householdId)).chatgpt).toBeNull();
      const before = await owned(owner, (tx) => tx.select().from(mcpConnections));
      const deniedQuery = await begin(owner, issuer.scopes_supported, id, redirect);
      const deniedRedirect = new URL((await limited.mcp.rejectConsent(owner.headers, deniedQuery)).redirectUri);
      expect(deniedRedirect.searchParams.get("iss")).toBe(origin + "/auth");
      expect(deniedRedirect.searchParams.get("error")).toBe("access_denied");
      const query = await begin(owner, issuer.scopes_supported, id, redirect);
      expect(transport).toHaveBeenCalled();
      expect(await owned(owner, (tx) => tx.select().from(mcpConnections))).toEqual(before);
      const preview = await limited.mcp.previewConsent(owner.headers, owner.householdId, query);
      expect(preview).toMatchObject({ provider: providerName, dataMode: "synthetic", settingsReviewRequired: true });
      expect(preview.scopes).toEqual([...readScopes, "offline_access"]);
      await expect(limited.mcp.prepareConsent(owner.headers, { householdId: owner.householdId, oauthQuery: query, noteIds: [],
        adultAttested: true, privacyAttested: true, providerSettingsReviewed: false, policyVersion: MCP_POLICY_VERSION })).rejects.toMatchObject({ code: "provider_settings_review_required" });
      const pending = await limited.mcp.prepareConsent(owner.headers, { householdId: owner.householdId, oauthQuery: query, noteIds: [],
        adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: MCP_POLICY_VERSION });
      const result = await limited.mcp.decideConsent(owner.headers, { pendingId: pending.pendingId, oauthQuery: query, accept: true });
      if (!result.accepted) throw new Error("Expected explicit fictional consent");
      expect(new URL(result.redirectUri).searchParams.get("iss")).toBe(origin + "/auth");
      const response = await exchange(new URL(result.redirectUri).searchParams.get("code")!, { client_id: id, redirect_uri: redirect, ...(chatgpt ? await assertion() : {}) });
      expect(response.status).toBe(200);
      const token = await response.json() as Tokens;
      expect(token.refresh_token).toBeTruthy();
      expect(await limited.mcp.authorize(bearer(token.access_token))).toMatchObject({ clientId: id, householdId: owner.householdId });
      const otherDisabled = createBetterAuth(db, { ...limitedEnv, MCP_CLAUDE_ENABLED: !grokBot && !chatgpt, MCP_CHATGPT_ENABLED: !grokBot && chatgpt }, { cookiePrefix, mcpMetadataFetch: transport });
      await expect(otherDisabled.mcp.authorize(bearer(token.access_token))).resolves.toMatchObject({ clientId: id });
      const selectedDisabled = createBetterAuth(db, { ...limitedEnv, MCP_CLAUDE_ENABLED: grokBot || chatgpt, MCP_CHATGPT_ENABLED: grokBot || !chatgpt, MCP_GROK_BOT_ENABLED: !grokBot }, { cookiePrefix, mcpMetadataFetch: transport });
      await expect(selectedDisabled.mcp.authorize(bearer(token.access_token))).rejects.toMatchObject({ code: "client_not_approved" });
      await expect(limited.mcp.revokeConnection(stranger.headers, result.connectionId)).rejects.toBeTruthy();
      await expect(limited.mcp.withGrantContext(bearer(token.access_token), ["notes:read"], async () => "must not run")).rejects.toMatchObject({ code: "insufficient_scope" });
      if (grokBot) {
        expect(overview.grokBot?.serverUrl).toBe(origin + "/api/mcp");
        expect(overview.grokBot?.scopes).toEqual([...readScopes, "offline_access"]);
        expect((await originalAuth.mcp.overview(owner.headers, owner.householdId)).grokBot).toBeNull();
        for (const scope of (["shopping:read", "chores:read"] as const).filter(scope => !readScopes.some(enabled => enabled === scope))) {
          await expect(limited.mcp.withGrantContext(bearer(token.access_token), [scope], async () => "must not run")).rejects.toMatchObject({ code: "insufficient_scope" });
        }
        for (const callback of GROK_BOT_METADATA_CALLBACKS.filter(uri => uri !== redirect)) {
          const otherProductQuery = await begin(owner, issuer.scopes_supported, id, callback);
          await expect(limited.mcp.previewConsent(owner.headers, owner.householdId, otherProductQuery)).rejects.toMatchObject({ code: "invalid_consent_query" });
        }
        const forged = createBetterAuth(db, { ...limitedEnv, MCP_READ_SCOPES: ["shopping:read", "chores:read", "notes:read"] }, { cookiePrefix, mcpMetadataFetch: transport });
        auth = forged;
        const notesQuery = await begin(owner, ["notes:read"], id, redirect);
        await expect(forged.mcp.previewConsent(owner.headers, owner.householdId, notesQuery)).rejects.toMatchObject({ code: "invalid_consent_query" });
        auth = limited;
      }
      if (chatgpt) {
        expect((await refresh(token.refresh_token, { client_id: id })).status).toBeGreaterThanOrEqual(400);
        expect((await refresh(token.refresh_token, { client_id: id, ...await assertion("https://wrong.example.test/token") })).status).toBeGreaterThanOrEqual(400);
        expect(transport.mock.calls.some(([input]) => String(input) === CHATGPT_JWKS_URI)).toBe(true);
      }
      const rotated = await refreshClient(token.refresh_token);
      expect(rotated.status).toBe(200);
      const next = await rotated.json() as Tokens;
      expect(next.refresh_token).not.toBe(token.refresh_token);
      await expect(originalAuth.mcp.authorize(bearer(next.access_token))).rejects.toMatchObject({ code: "client_not_approved" });
      const beforeInvalid = transport.mock.calls.length;
      const invalid = new URLSearchParams({ response_type: "code", redirect_uri: redirect, scope: issuer.scopes_supported.join(" "),
        resource: origin + "/api/mcp", code_challenge: challenge, code_challenge_method: "S256", state: randomUUID() });
      for (const bad of ["https://127.0.0.1/metadata", id + "?copy=1", "https://chatgpt.com.attacker.test/oauth/client.json"]) {
        invalid.set("client_id", bad);
        const denied = await fetch(origin + "/auth/oauth2/authorize?" + invalid, { headers: owner.headers, redirect: "manual" });
        expect(denied.status).toBeGreaterThanOrEqual(400);
      }
      expect(transport.mock.calls.length).toBe(beforeInvalid);
      await withMcpProviderContext(db, (tx) => tx.update(mcpClientProfiles).set({ enabled: false }).where(eq(mcpClientProfiles.clientId, id)));
      await expect(limited.mcp.authorize(bearer(next.access_token))).rejects.toMatchObject({ code: "client_not_approved" });
      await expect(begin(owner, issuer.scopes_supported, id, redirect)).resolves.toBeTruthy();
      const [disabled] = await withMcpProviderContext(db, (tx) => tx.select().from(mcpClientProfiles).where(eq(mcpClientProfiles.clientId, id)));
      expect(disabled.enabled).toBe(false);
      await withMcpProviderContext(db, (tx) => tx.update(mcpClientProfiles).set({ enabled: true }).where(eq(mcpClientProfiles.clientId, id)));
      if (chatgpt) {
        metadata.jwks_uri = "https://chatgpt.com/unapproved-keys.json";
        expect((await refreshClient(next.refresh_token)).status).toBeGreaterThanOrEqual(400);
        expect(transport.mock.calls.some(([input]) => String(input) === metadata.jwks_uri)).toBe(false);
        await expect(limited.mcp.authorize(bearer(next.access_token))).rejects.toMatchObject({ code: "client_not_approved" });
        metadata.jwks_uri = CHATGPT_JWKS_URI;
        await begin(owner, issuer.scopes_supported, id, redirect);
      }
      metadata.redirect_uris = ["https://attacker.test/callback"];
      expect((await refreshClient(next.refresh_token)).status).toBeGreaterThanOrEqual(400);
      await expect(limited.mcp.authorize(bearer(next.access_token))).rejects.toMatchObject({ code: "client_not_approved" });
      metadata.redirect_uris = grokBot ? [...GROK_BOT_METADATA_CALLBACKS] : [redirect];
      await begin(owner, issuer.scopes_supported, id, redirect);
      await limited.mcp.setHouseholdEnabled(owner.headers, owner.householdId, false);
      await expect(limited.mcp.authorize(bearer(next.access_token))).rejects.toBeTruthy();
      await limited.mcp.setHouseholdEnabled(owner.headers, owner.householdId, true);
      await expect(limited.mcp.authorize(bearer(next.access_token))).rejects.toBeTruthy();
    } finally { auth = originalAuth; }
  });
  it("links a discovery-driven Gemini client without notes and rejects disabled scopes on existing grants", async () => {
    const oldToken = await connect(owner, scopes, [ownNote]);
    const oldQuery = await begin(owner, scopes);
    const originalAuth = auth;
    const limitedEnv: Env = { ...env, MCP_READ_SCOPES: ["shopping:read", "chores:read"] };
    const limited = createBetterAuth(db, limitedEnv, { cookiePrefix });
    const gateway = mcpGateway(db, limited.mcp, limitedEnv);
    const expected = ["shopping:read", "chores:read", "offline_access"];
    // The loopback server's auth handlers resolve this variable per request.
    auth = limited;
    try {
      const issuer = z.object({ scopes_supported: z.array(z.string()) }).parse(await (await limited.mcp.metadata(new Request(origin + "/.well-known/oauth-authorization-server/auth"))).json());
      expect(issuer.scopes_supported).toEqual(expected);
      for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
        expect(await (await gateway.request(origin + path)).json()).toMatchObject({ scopes_supported: expected });
      }
      await expect(limited.mcp.registerClient(owner.headers, { name: "Rejected notes profile", provider: "gemini", profileVersion: "limited.v1",
        redirectUris: [callback], tokenEndpointAuthMethod: "none", dataMode: "household", scopes: ["notes:read"], enabled: true })).rejects.toMatchObject({ code: "invalid_scope" });
      await expect(limited.mcp.prepareConsent(owner.headers, { householdId: owner.householdId, oauthQuery: oldQuery, noteIds: [],
        adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: MCP_POLICY_VERSION })).rejects.toMatchObject({ code: "invalid_scope" });
      await expect(limited.mcp.authorize(bearer(oldToken.access_token))).rejects.toMatchObject({ code: "scope_disabled" });
      const clientCallback = "https://oauth-redirect.googleusercontent.com/r/fictional_limited_pilot";
      const client = await limited.mcp.registerClient(owner.headers, { name: "Fictional no-notes pilot", provider: "gemini", profileVersion: "limited.v1",
        redirectUris: [clientCallback], tokenEndpointAuthMethod: "none", dataMode: "household", scopes: expected, enabled: true });
      clientIds.push(client.client_id);
      const query = await begin(owner, issuer.scopes_supported, client.client_id, clientCallback);
      const pending = await limited.mcp.prepareConsent(owner.headers, { householdId: owner.householdId, oauthQuery: query, noteIds: [],
        adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: MCP_POLICY_VERSION });
      const decision = await limited.mcp.decideConsent(owner.headers, { pendingId: pending.pendingId, oauthQuery: query, accept: true });
      if (!decision.accepted) throw new Error("Expected accepted fictional consent");
      const response = await exchange(new URL(decision.redirectUri).searchParams.get("code")!, { client_id: client.client_id, redirect_uri: clientCallback });
      expect(response.status).toBe(200);
      const token = await response.json() as Tokens;
      expect(token.refresh_token).toBeTruthy();
      expect(await limited.mcp.authorize(bearer(token.access_token))).toMatchObject({ clientId: client.client_id, scopes: expected });
      await expect(limited.mcp.withGrantContext(bearer(token.access_token), ["notes:read"], async () => "must not run")).rejects.toMatchObject({ code: "insufficient_scope" });
      const rotated = await refresh(token.refresh_token, { client_id: client.client_id, scope: issuer.scopes_supported.join(" ") });
      expect(rotated.status).toBe(200);
      const next = await rotated.json() as Tokens;
      expect(next.refresh_token).toBeTruthy();
      expect(next.refresh_token).not.toBe(token.refresh_token);
      expect((await limited.mcp.authorize(bearer(next.access_token))).scopes).toEqual(expected);
      const wideRefresh = await refresh(next.refresh_token, { client_id: client.client_id, scope: scopes.join(" ") });
      expect(wideRefresh.status).toBeGreaterThanOrEqual(400);
      await limited.mcp.revokeConnection(owner.headers, decision.connectionId);
    } finally { auth = originalAuth; }
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
  it("advertises refresh support without granting background access to an access-only request", async () => {
    const token = await connect(owner, ["shopping:read"]);
    expect(token.refresh_token).toBeUndefined();
    expect(await auth.mcp.authorize(bearer(token.access_token))).toMatchObject({ scopes: ["shopping:read"] });
    const stored = await withMcpProviderContext(db, (tx) => tx.select({ id: oauthRefreshToken.id }).from(oauthRefreshToken).where(eq(oauthRefreshToken.referenceId, token.connectionId)));
    expect(stored).toEqual([]);
    const response = await post(`/api/mcp-auth/connections/${token.connectionId}/narrow`, { scopes: ["shopping:read", "offline_access"], noteIds: [] });
    expect(response.status).toBe(409);
    await auth.mcp.revokeConnection(owner.headers, token.connectionId);
  });
  it.each(["2025-03-26", "2025-06-18", "2025-11-25"])("serves %s clients through the bearer-only Next bridge with scope and revocation checks", async (version) => {
    const bridgePath = new URL("../../../web/src/app/api/mcp/route.ts", import.meta.url).href;
    const { POST: proxyMcp } = await import(bridgePath) as { POST: (request: Request) => Promise<Response> };
    const token = await connect();
    const previousApi = process.env.API_URL;
    process.env.API_URL = origin;
    let sequence = 0;
    const request = (method: string, params?: Record<string, unknown>, authenticated = true, notification = false) => proxyMcp(new Request(origin + "/api/mcp", {
      method: "POST", headers: { host: new URL(origin).host, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": version,
        cookie: owner.headers.get("cookie")!, ...(authenticated ? { authorization: "Bearer " + token.access_token } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: ++sequence }), method, ...(params ? { params } : {}) }),
    }));
    const result = async (response: Response) => {
      expect(response.status).toBe(200); expect(response.headers.has("set-cookie")).toBe(false);
      const text = await response.text();
      return JSON.parse(response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find((line) => line.startsWith("data: "))!.slice(6) : text);
    };
    try {
      expect((await request("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "synthetic-legacy", version: "1" } }, false)).status).toBe(401);
      const initialized = await result(await request("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "synthetic-legacy", version: "1" } }));
      expect(initialized.result.protocolVersion).toBe(version);
      expect((await request("notifications/initialized", undefined, true, true)).status).toBe(202);
      expect((await result(await request("tools/list"))).result.tools.map((tool: { name: string }) => tool.name)).toEqual(["get_connection_context", "list_shopping_items"]);
      expect((await result(await request("tools/call", { name: "get_connection_context", arguments: {} }))).result.structuredContent.capabilities).toEqual(["shopping:read"]);
      expect((await result(await request("tools/call", { name: "list_selected_notes", arguments: {} }))).error).toBeDefined();
      expect((await request("resources/list")).status).toBe(400);
      await auth.mcp.revokeConnection(owner.headers, token.connectionId);
      expect((await request("tools/call", { name: "get_connection_context", arguments: {} })).status).toBe(401);
    } finally { if (previousApi === undefined) delete process.env.API_URL; else process.env.API_URL = previousApi; }
  });
  it("rejects legacy and modern batches before any tool executes", async () => {
    const token = await connect();
    const run = vi.fn(contextTool.run);
    const gateway = mcpGateway(db, auth.mcp, env, [{ ...contextTool, run }]);
    try {
      for (const version of ["2025-11-25", "2026-07-28"]) {
        const headers = { host: new URL(origin).host, authorization: "Bearer " + token.access_token, accept: "application/json, text/event-stream",
          "content-type": "application/json", "mcp-protocol-version": version, "mcp-method": "tools/call", "mcp-name": "get_connection_context" };
        const meta = { "io.modelcontextprotocol/protocolVersion": version, "io.modelcontextprotocol/clientInfo": { name: "synthetic-batch", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
        const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_connection_context", arguments: {}, _meta: meta } };
        for (const batch of [[], [call], Array.from({ length: 100 }, (_, index) => ({ ...call, id: index + 1 }))]) {
          const response = await gateway.request(origin + "/api/mcp", { method: "POST", headers, body: JSON.stringify(batch) });
          expect(response.status).toBe(400);
          expect(await response.json()).toEqual({ error: "batch_not_supported" });
          expect(run).not.toHaveBeenCalled();
        }
      }
      const events = await owned(owner, (tx) => tx.select().from(mcpAccessEvents).where(eq(mcpAccessEvents.connectionId, token.connectionId)));
      expect(events).toHaveLength(6);
      expect(events.every((event) => event.tool === "protocol" && event.outcome === "invalid_request")).toBe(true);
      expect(await owned(owner, (tx) => tx.select().from(mcpRequestLeases).where(eq(mcpRequestLeases.connectionId, token.connectionId)))).toEqual([]);
    } finally { await auth.mcp.revokeConnection(owner.headers, token.connectionId); }
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
      const denied = await proxyMcp(new Request(origin + "/api/mcp", { method: "POST", headers: { host: new URL(origin).host, cookie: owner.headers.get("cookie")!, "content-type": "application/json" }, body: "{}" }));
      expect(denied.status).toBe(401); expect(denied.headers.get("www-authenticate")).toContain("oauth-protected-resource/api/mcp");
    } finally { await client.close(); if (previousApi === undefined) delete process.env.API_URL; else process.env.API_URL = previousApi; }
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
  it("isolates the side-effect snapshot from unrelated push users while detecting fixture writes", async () => {
    const outsiderId = randomUUID(), subscriptionId = randomUUID();
    await withSystemContext(db, (tx) => tx.insert(users).values({ id: outsiderId, email: outsiderId + "@example.test", displayName: "synthetic snapshot outsider" }));
    try {
      const before = await domainSnapshot();
      await db.insert(pushSubscriptions).values({ userId: outsiderId, endpoint: "https://push.example.test/" + randomUUID(), p256dh: "synthetic", authKey: "synthetic" });
      expect(await domainSnapshot()).toEqual(before);
      await db.insert(pushSubscriptions).values({ id: subscriptionId, userId: owner.userId, endpoint: "https://push.example.test/" + randomUUID(), p256dh: "synthetic", authKey: "synthetic" });
      expect((await domainSnapshot()).push_subscriptions).toContainEqual(expect.objectContaining({ id: subscriptionId, user_id: owner.userId }));
    } finally {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId));
      await withSystemContext(db, (tx) => tx.delete(users).where(eq(users.id, outsiderId)));
    }
  });
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
      const directoryTools = (await client.listTools()).tools;
      expect(directoryTools.map((tool) => tool.name)).toEqual(["get_connection_context", "list_shopping_items", "list_chores", "list_selected_notes", "get_selected_note"]);
      for (const tool of directoryTools) {
        expect(tool.title).toBeTruthy();
        expect(tool.name.length).toBeLessThanOrEqual(64);
        expect(tool.annotations).toMatchObject({ title: tool.title, readOnlyHint: true, destructiveHint: false });
      }
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
  it("retains child-assigned chores while withholding member and account names on every read", async () => {
    const childName = "Fictional Child Name Canary", accountName = "Fictional Child Account Canary";
    const [originalMember] = await owned(owner, (tx) => tx.select().from(householdMembers).where(eq(householdMembers.id, child.memberId)));
    const [originalUser] = await withSystemContext(db, (tx) => tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, child.userId)));
    const ids: string[] = Array.from({ length: 4 }, () => randomUUID());
    const client = new Client({ name: "synthetic-assignee-privacy", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    try {
      await owned(owner, async (tx) => {
        await tx.update(householdMembers).set({ role: "child", name: childName, accessRevokedAt: null }).where(eq(householdMembers.id, child.memberId));
        await tx.insert(chores).values(ids.map((id, i) => ({ id, householdId: owner.householdId, description: "Synthetic assignment " + i,
          assigneeMemberId: i < 2 ? child.memberId : i === 2 ? owner.memberId : null, done: i === 1, dueDate: "2026-10-27" })));
      });
      await withSystemContext(db, (tx) => tx.update(users).set({ displayName: accountName }).where(eq(users.id, child.userId)));
      const { token } = await toolAccess([], ["chores:read", "offline_access"]);
      await client.connect(new StreamableHTTPClientTransport(new URL(origin + "/api/mcp"), { requestInit: { headers: { authorization: "Bearer " + token.access_token } } }));
      const read = async (args: Record<string, unknown> = {}) => {
        const result = await client.callTool({ name: "list_chores", arguments: { status: "all", ...args } });
        expect(result.isError).not.toBe(true);
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(childName); expect(serialized).not.toContain(accountName);
        expect(serialized).not.toContain(child.memberId); expect(serialized).not.toContain(child.userId);
        return result.structuredContent as { data: { id: string; assignee: string | null; completed: boolean; dueDate: string | null }[]; nextCursor: string | null };
      };
      const before = await domainSnapshot();
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await read({ limit: 1, ...(cursor ? { cursor } : {}) });
        for (const row of page.data) {
          seen.push(row.id);
          const i = ids.indexOf(row.id);
          if (i >= 0) expect(row).toMatchObject({ assignee: i < 2 ? "Household member" : i === 2 ? "Synthetic Adult" : null, completed: i === 1, dueDate: "2026-10-27" });
        }
        cursor = page.nextCursor ?? undefined;
        expect(seen.length).toBeLessThan(20);
      } while (cursor);
      expect(new Set(seen).size).toBe(seen.length);
      for (const id of ids) expect(seen).toContain(id);
      expect(await domainSnapshot()).toEqual(before);

      // A missing member name must not expose the account-name fallback.
      await owned(owner, (tx) => tx.update(householdMembers).set({ name: null }).where(eq(householdMembers.id, child.memberId)));
      expect((await read()).data.find((row) => row.id === ids[0])?.assignee).toBe("Household member");
      // An existing connection must use the current role and revocation state.
      await owned(owner, (tx) => tx.update(householdMembers).set({ role: "member", name: "Fictional Adult Label" }).where(eq(householdMembers.id, child.memberId)));
      expect((await read()).data.find((row) => row.id === ids[0])?.assignee).toBe("Fictional Adult Label");
      await owned(owner, (tx) => tx.update(householdMembers).set({ role: "child" }).where(eq(householdMembers.id, child.memberId)));
      expect((await read()).data.find((row) => row.id === ids[0])?.assignee).toBe("Household member");
      await owned(owner, (tx) => tx.update(householdMembers).set({ accessRevokedAt: new Date() }).where(eq(householdMembers.id, child.memberId)));
      expect((await read()).data.find((row) => row.id === ids[0])?.assignee).toBeNull();
    } finally {
      await client.close();
      await owned(owner, async (tx) => {
        await tx.delete(chores).where(inArray(chores.id, ids));
        await tx.update(householdMembers).set({ role: originalMember.role, name: originalMember.name, accessRevokedAt: originalMember.accessRevokedAt }).where(eq(householdMembers.id, child.memberId));
      });
      await withSystemContext(db, (tx) => tx.update(users).set({ displayName: originalUser.displayName }).where(eq(users.id, child.userId)));
    }
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
  it("keeps unapproved Gemini profiles disabled by default", async () => {
    const input = { name: "Synthetic policy fixture", redirectUris: [callback], tokenEndpointAuthMethod: "none" as const, scopes,
      provider: "gemini", profileVersion: "synthetic-v1", dataMode: "household" as const };
    const client = await auth.mcp.registerClient(owner.headers, input);
    clientIds.push(client.client_id);
    const query = await begin(owner, ["shopping:read", "offline_access"], client.client_id);
    const response = await post("/api/mcp-auth/consents/prepare", { householdId: owner.householdId, oauthQuery: query, noteIds: [], adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: MCP_POLICY_VERSION });
    expect(response.status).toBe(403);
  });
  it.each(["chatgpt", "claude", "gemini"])("requires fresh privacy and settings review before an approved %s household client receives data", async (provider) => {
    const providerCallback = provider === "gemini" ? "https://oauth-redirect.googleusercontent.com/r/fictional_pilot_callback" : provider === "claude" ? "https://claude.ai/api/mcp/auth_callback" : "https://chatgpt.com/connector/oauth/fictional_pilot_callback";
    const client = await auth.mcp.registerClient(owner.headers, { name: "Fictional informed-consent pilot", provider, profileVersion: `pilot.${provider}.disclosed.v1`,
      redirectUris: [providerCallback], tokenEndpointAuthMethod: "none", dataMode: "household", scopes: ["shopping:read", "offline_access"], enabled: true });
    clientIds.push(client.client_id);
    const query = await begin(owner, ["shopping:read", "offline_access"], client.client_id, providerCallback);
    const preview = await post("/api/mcp-auth/consents/preview", { householdId: owner.householdId, oauthQuery: query });
    expect(await preview.json()).toMatchObject({ provider, dataMode: "household", settingsReviewRequired: true, policyVersion: MCP_POLICY_VERSION });
    const input = { householdId: owner.householdId, oauthQuery: query, noteIds: [], adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: MCP_POLICY_VERSION };
    for (const providerSettingsReviewed of [false, undefined]) {
      const denied = await post("/api/mcp-auth/consents/prepare", { ...input, providerSettingsReviewed });
      expect(denied.status).toBe(400);
      expect(await denied.json()).toMatchObject({ error: "provider_settings_review_required" });
    }
    expect((await post("/api/mcp-auth/consents/prepare", { ...input, policyVersion: "2026-10-23.v2" })).status).toBe(400);
    expect((await post("/api/mcp-auth/consents/prepare", { ...input, privacyAttested: false })).status).toBe(400);
    expect((await post("/api/mcp-auth/consents/prepare", { ...input, policyVersion: "2026-10-21.v1" })).status).toBe(400);
    expect(await owned(owner, (tx) => tx.select().from(mcpConnections).where(eq(mcpConnections.clientId, client.client_id)))).toEqual([]);
    const pending = await prepare(query);
    const oldQuery = await begin(owner, ["shopping:read", "offline_access"], client.client_id, providerCallback);
    const oldPending = await prepare(oldQuery);
    await owned(owner, async (tx) => {
      const [prepared] = await tx.select().from(mcpPendingConsents).where(eq(mcpPendingConsents.id, oldPending.pendingId));
      const [grant] = await tx.select().from(mcpConnections).where(eq(mcpConnections.id, prepared.connectionId));
      const connectionId = randomUUID();
      await tx.insert(mcpConnections).values({ ...grant, id: connectionId, policyVersion: "2026-10-21.v1" });
      await tx.update(mcpPendingConsents).set({ connectionId }).where(eq(mcpPendingConsents.id, oldPending.pendingId));
    });
    expect((await decide(oldQuery, oldPending.pendingId)).status).toBe(409);
    const decision = await decide(query, pending.pendingId);
    expect(decision.status).toBe(200);
    const accepted = await decision.json() as { redirectUri: string; connectionId: string };
    const response = await exchange(new URL(accepted.redirectUri).searchParams.get("code")!, { client_id: client.client_id, redirect_uri: providerCallback });
    expect(response.status).toBe(200);
    const token = await response.json() as Tokens;
    expect(await auth.mcp.authorize(bearer(token.access_token))).toMatchObject({ clientId: client.client_id, scopes: ["shopping:read", "offline_access"] });
    const [grant] = await owned(owner, (tx) => tx.select().from(mcpConnections).where(eq(mcpConnections.id, accepted.connectionId)));
    expect(grant).toMatchObject({ policyVersion: MCP_POLICY_VERSION, clientProfileVersion: `pilot.${provider}.disclosed.v1` });
    expect(grant.privacyAttestedAt).not.toBeNull();
    await auth.mcp.revokeConnection(owner.headers, accepted.connectionId);
    await expect(auth.mcp.authorize(bearer(token.access_token))).rejects.toMatchObject({ status: 401 });
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
    expect((await post("/api/mcp-auth/consents/prepare", { householdId: owner.householdId, oauthQuery: a, noteIds: [], adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: MCP_POLICY_VERSION })).status).toBe(409);
    expect((await decide(b, pa.pendingId)).status).toBe(409);
    expect((await decide(a, pa.pendingId, true, stranger)).status).toBe(409);
    const [ra, rb] = await Promise.all([decide(a, pa.pendingId), decide(b, pb.pendingId)]);
    expect(ra.status).toBe(200); expect(rb.status).toBe(200);
    expect((await ra.json() as { connectionId: string }).connectionId).not.toBe((await rb.json() as { connectionId: string }).connectionId);
    expect((await decide(a, pa.pendingId)).status).toBe(409);
    expect((await post("/api/mcp-auth/consents/prepare", { householdId: owner.householdId, oauthQuery: a.replace("shopping", "notes"), noteIds: [], adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: MCP_POLICY_VERSION })).status).toBe(400);
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
    const input = { householdId: owner.householdId, oauthQuery: query, noteIds: [], adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: MCP_POLICY_VERSION };
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
    const input = { householdId: owner.householdId, oauthQuery: query, noteIds: [foreignNote], adultAttested: true, privacyAttested: true, providerSettingsReviewed: true, policyVersion: MCP_POLICY_VERSION };
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
