import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { decodeJwt, decodeProtectedHeader, importJWK, SignJWT } from "jose";
import { symmetricDecrypt } from "better-auth/crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createBetterAuth, MCP_POLICY_VERSION } from "@domi-ops/auth";
import { envSchema, type Env } from "@domi-ops/config";
import {
  createDb, closeDb, households, householdMembers, users, notes, mcpConnections, mcpPendingConsents,
  mcpNoteSelections, oauthClient, oauthRefreshToken, jwks, withHouseholdContext, withUserLookupContext,
  withMcpProviderContext, withSystemContext, withWorkerScanContext, type Database,
} from "@domi-ops/db";
import { mcpAuthorizationRoutes } from "./mcp-authorization.js";

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

  beforeAll(async () => {
    db = createDb(url!);
    const [role] = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(sql`select rolsuper, rolbypassrls from pg_roles where rolname=current_user`);
    expect(role.rolsuper).toBe(false); expect(role.rolbypassrls).toBe(false);
    const app = new Hono();
    server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.listening ? resolve() : server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected loopback test server");
    origin = "http://127.0.0.1:" + address.port;
    env = envSchema.parse({ NODE_ENV: "test", DEPLOYMENT_MODE: mode, PUBLIC_APP_URL: origin, API_URL: origin,
      DATABASE_URL: url, SESSION_SECRET: "synthetic-who469-session-secret-for-disposable-fixtures-only", MCP_ENABLED: "true", MCP_SYNTHETIC_DEPLOYMENT: "true", MODULES_ENABLED: "core" });
    auth = createBetterAuth(db, env, { cookiePrefix, deferHouseholdMembership: async () => true });
    app.all("/auth/*", (c) => auth.handler(c.req.raw));
    app.get("/.well-known/oauth-authorization-server/auth", (c) => auth.mcp.metadata(c.req.raw));
    app.route("/api/mcp-auth", mcpAuthorizationRoutes(auth.mcp, env));
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
});
