import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { and, eq, exists, gt, inArray, isNull, or } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { oauthProvider, oauthProviderAuthServerMetadata, verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import type { betterAuth, BetterAuthOptions } from "better-auth";
import { isModuleEnabled, parseHouseholdModulesJson, type Env } from "@domi-ops/config";
import {
  householdMembers, households, mcpClientProfiles, mcpConnections, mcpHouseholdSettings,
  mcpNoteSelections, mcpPendingConsents, notes, noteShares, oauthClient, oauthConsent,
  oauthRefreshToken, oauthAccessToken, withHouseholdContext, withMcpConnectionContext,
  withMcpProviderContext, withUserLookupContext, type Database,
} from "@domi-ops/db";

export const MCP_SCOPES = ["shopping:read", "chores:read", "notes:read", "offline_access"] as const;
export const MCP_POLICY_VERSION = "2026-10-21.v1";
const TTL = 30 * 86400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Connection = typeof mcpConnections.$inferSelect;
type ProviderAuth = ReturnType<typeof betterAuth<{ plugins: [ReturnType<typeof oauthProvider>] }>>;
type Auth = {
  options: BetterAuthOptions;
  $context: Promise<unknown>;
  handler: (request: Request) => Promise<Response>;
  api: Pick<ReturnType<typeof betterAuth>["api"], "getSession"> & Pick<ProviderAuth["api"], "adminCreateOAuthClient" | "getOAuthServerConfig">;
};
type Binding = { connection: Connection; sessionId: string };

export class McpAuthorizationError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 401 | 403 | 409 = 403) { super(code); }
}
function deny(code = "mcp_access_denied", status: 400 | 401 | 403 | 409 = 403): never { throw new McpAuthorizationError(code, status); }
function uuid(value: string) { if (!UUID.test(value)) deny("invalid_identifier", 400); return value; }
function hash(query: string) { return createHash("sha256").update(query).digest("hex"); }
function sameScopes(a: readonly string[], b: readonly string[]) { return a.length === b.length && a.every((s) => b.includes(s)); }

export function mcpUrls(env: Pick<Env, "PUBLIC_APP_URL">) {
  const url = new URL(env.PUBLIC_APP_URL);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error("MCP requires a canonical PUBLIC_APP_URL origin");
  return { origin: url.origin, issuer: url.origin + "/auth", resource: url.origin + "/api/mcp" };
}

export function createMcpAuthorization(db: Database, env: Env, secret: string) {
  const urls = mcpUrls(env);
  const approval = new AsyncLocalStorage<Binding>();
  const operatorRegistration = new AsyncLocalStorage<boolean>();

  async function clientProfile(clientId: string) {
    const row = await withMcpProviderContext(db, async (tx) => {
      const [row] = await tx.select({ profile: mcpClientProfiles, client: oauthClient })
        .from(mcpClientProfiles).innerJoin(oauthClient, eq(oauthClient.clientId, mcpClientProfiles.clientId))
        .where(and(eq(mcpClientProfiles.clientId, clientId), eq(mcpClientProfiles.enabled, true))).limit(1);
      return row;
    });
    if (!row || row.client.disabled || row.client.skipConsent || !row.client.requirePKCE) deny("client_not_approved");
    if (row.profile.dataMode === "synthetic" && !env.MCP_SYNTHETIC_DEPLOYMENT) deny("synthetic_client_only");
    if (row.profile.provider === "gemini" && row.profile.dataMode !== "synthetic") deny("synthetic_client_only");
    return row;
  }

  async function member(tx: Database, userId: string, householdId: string) {
    const [row] = await tx.select().from(householdMembers).where(and(
      eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId), isNull(householdMembers.accessRevokedAt),
    )).limit(1);
    if (!row || !["owner", "admin", "member"].includes(row.role)) deny("member_not_eligible");
    return row;
  }

  async function householdAccess(tx: Database, householdId: string, scopes: readonly string[]) {
    if (!env.MCP_ENABLED || env.DEMO_MODE) deny("mcp_disabled");
    const [settings] = await tx.select().from(mcpHouseholdSettings).where(eq(mcpHouseholdSettings.householdId, householdId)).limit(1);
    const [household] = await tx.select({ modules: households.modulesEnabled }).from(households).where(eq(households.id, householdId)).limit(1);
    if (!settings?.enabled || !household) deny("mcp_disabled");
    const modules = parseHouseholdModulesJson(household.modules);
    if (scopes.some((s) => s !== "offline_access") && (!isModuleEnabled(env, "core") || !modules.includes("core"))) deny("module_disabled");
  }

  async function liveConnection(userId: string, connectionId: string, scopes: readonly string[], clientId?: string) {
    uuid(userId); uuid(connectionId);
    const connection = await withMcpConnectionContext(db, userId, connectionId, async (lookup) => {
      const [connection] = await lookup.select().from(mcpConnections).where(and(eq(mcpConnections.id, connectionId), eq(mcpConnections.userId, userId))).limit(1);
      if (!connection || connection.status !== "active" || connection.revokedAt || connection.expiresAt.getTime() <= Date.now() ||
        connection.issuer !== urls.issuer || connection.resource !== urls.resource || connection.policyVersion !== MCP_POLICY_VERSION ||
        (clientId && clientId !== connection.clientId) || scopes.some((s) => !connection.scopes.includes(s))) deny("inactive_grant", 401);
      return connection;
    });
    const profile = await clientProfile(connection.clientId);
    if (profile.profile.version !== connection.clientProfileVersion) deny("consent_required", 401);
    return withUserLookupContext(db, userId, (lookup) => withHouseholdContext(lookup, connection.householdId, async (tx) => {
        const current = await member(tx, userId, connection.householdId);
        if (current.id !== connection.memberId || current.role !== connection.grantedRole) deny("inactive_grant", 401);
        await householdAccess(tx, connection.householdId, scopes);
        return connection;
      }));
  }

  const provider = oauthProvider({
    loginPage: "/login", consentPage: "/ai/consent",
    scopes: [...MCP_SCOPES],
    resources: [{ identifier: urls.resource, allowedScopes: [...MCP_SCOPES], accessTokenTtl: 300 }],
    clientRegistrationDefaultResources: [urls.resource], clientRegistrationAllowedResources: [urls.resource],
    clientRegistrationAllowedScopes: [...MCP_SCOPES], clientRegistrationRequirePKCE: true,
    allowDynamicClientRegistration: false, allowUnauthenticatedClientRegistration: false,
    allowClientKeyRotation: false, allowPublicClientPrelogin: false,
    clientPrivileges: () => operatorRegistration.getStore() === true,
    resourcePrivileges: () => operatorRegistration.getStore() === true,
    grantTypes: ["authorization_code", "refresh_token"],
    storeTokens: "hashed", storeClientSecret: "hashed",
    accessTokenExpiresIn: 300, codeExpiresIn: 600, refreshTokenExpiresIn: TTL / 1000, refreshTokenReuseInterval: 0,
    postLogin: {
      page: "/ai/consent",
      shouldRedirect: () => !approval.getStore(),
      consentReferenceId: ({ user, session, scopes }) => {
        const bound = approval.getStore();
        if (!bound || bound.connection.userId !== user.id || bound.sessionId !== session.id || !sameScopes(scopes, bound.connection.scopes)) {
          throw new APIError("FORBIDDEN", { error: "consent_required" });
        }
        return bound.connection.id;
      },
    },
    customAccessTokenClaims: async ({ user, referenceId, scopes, resources }) => {
      try {
        if (!user || !referenceId || !resources?.length || resources.some((r) => r !== urls.resource)) deny();
        const connection = await liveConnection(user.id, referenceId, scopes);
        return { domi_grant_id: connection.id };
      } catch { throw new APIError("FORBIDDEN", { error: "invalid_grant" }); }
    },
  });

  return { provider, attach(auth: Auth) {
    const verify = oauthProviderResourceClient(auth).getActions().verifyAccessTokenRequest;
    async function session(headers: Headers) {
      const result = await auth.api.getSession({ headers });
      if (!result?.user || !result.session) deny("unauthorized", 401);
      return result;
    }
    async function checkedQuery(query: string) {
      if (query.length > 12_000 || !await verifyOAuthQueryParams(query, secret)) deny("invalid_consent_query", 400);
      const p = new URLSearchParams(query);
      for (const key of ["client_id", "redirect_uri", "scope", "resource", "code_challenge", "code_challenge_method", "response_type", "exp", "ba_iat"]) {
        if (p.getAll(key).length !== 1) deny("invalid_consent_query", 400);
      }
      if (p.get("resource") !== urls.resource || p.get("response_type") !== "code" || p.get("code_challenge_method") !== "S256" || p.has("claims")) deny("invalid_consent_query", 400);
      const scopes = p.get("scope")!.split(" ").filter(Boolean);
      if (!scopes.length || new Set(scopes).size !== scopes.length || scopes.some((s) => !MCP_SCOPES.includes(s as typeof MCP_SCOPES[number]))) deny("invalid_scope", 400);
      const profile = await clientProfile(p.get("client_id")!);
      if (!profile.client.redirectUris.includes(p.get("redirect_uri")!) || scopes.some((s) => !profile.client.scopes?.includes(s))) deny("invalid_consent_query", 400);
      return { scopes, profile, queryHash: hash(query) };
    }
    return {
      urls,
      metadata: oauthProviderAuthServerMetadata(auth),
      /** Trusted operator/CLI entry point. Never mount this as an HTTP route. */
      async registerClient(headers: Headers, input: { name: string; redirectUris: string[]; tokenEndpointAuthMethod: "none" | "client_secret_post" | "client_secret_basic"; scopes: string[]; provider: string; profileVersion: string; dataMode: "synthetic" | "household"; enabled?: boolean }) {
        if (!env.MCP_ENABLED) deny("mcp_disabled");
        await session(headers);
        if (!input.name || input.name.length > 128 || !input.profileVersion || input.profileVersion.length > 128 || !["chatgpt", "claude", "gemini", "local", "other"].includes(input.provider)) deny("invalid_client_profile", 400);
        if (input.provider === "gemini" && input.dataMode !== "synthetic") deny("synthetic_client_only");
        if (input.dataMode === "synthetic" && !env.MCP_SYNTHETIC_DEPLOYMENT) deny("synthetic_client_only");
        if (!input.scopes.length || input.scopes.some((s) => !MCP_SCOPES.includes(s as typeof MCP_SCOPES[number]))) deny("invalid_scope", 400);
        if (!input.redirectUris.length || input.redirectUris.length > 10) deny("invalid_redirect_uri", 400);
        for (const uri of input.redirectUris) {
          const url = new URL(uri);
          const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
          if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && loopback && url.protocol === "http:"))) deny("invalid_redirect_uri", 400);
        }
        const client = await operatorRegistration.run(true, () => auth.api.adminCreateOAuthClient({ headers, body: {
          client_name: input.name, redirect_uris: input.redirectUris, token_endpoint_auth_method: input.tokenEndpointAuthMethod,
          application_type: "web", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
          scope: [...new Set(input.scopes)].join(" "), resources: [urls.resource], require_pkce: true, skip_consent: false,
        } }));
        await withMcpProviderContext(db, (tx) => tx.insert(mcpClientProfiles).values({ clientId: client.client_id, provider: input.provider, version: input.profileVersion, dataMode: input.dataMode, enabled: input.enabled ?? false }));
        return client;
      },
      async prepareConsent(headers: Headers, input: { householdId: string; oauthQuery: string; noteIds: string[]; adultAttested: boolean; privacyAttested: boolean; policyVersion: string }) {
        const current = await session(headers);
        if (input.adultAttested !== true || input.privacyAttested !== true || input.policyVersion !== MCP_POLICY_VERSION) deny("attestation_required");
        uuid(input.householdId);
        if (input.noteIds.length > 100 || new Set(input.noteIds).size !== input.noteIds.length) deny("invalid_note_selection", 400);
        input.noteIds.forEach(uuid);
        const query = await checkedQuery(input.oauthQuery);
        if (input.noteIds.length && !query.scopes.includes("notes:read")) deny("invalid_scope", 400);
        return withUserLookupContext(db, current.user.id, (lookup) => withHouseholdContext(lookup, input.householdId, async (tx) => {
          const owner = await member(tx, current.user.id, input.householdId);
          await householdAccess(tx, input.householdId, query.scopes);
          if (input.noteIds.length) {
            const selected = await tx.select({ id: notes.id }).from(notes).where(and(eq(notes.householdId, input.householdId), inArray(notes.id, input.noteIds), or(
              eq(notes.visibility, "household"), eq(notes.createdByUserId, current.user.id),
              exists(tx.select({ id: noteShares.noteId }).from(noteShares).where(and(eq(noteShares.noteId, notes.id), eq(noteShares.memberId, owner.id)))),
            )));
            if (selected.length !== input.noteIds.length) deny("note_unavailable");
          }
          const now = new Date();
          const [connection] = await tx.insert(mcpConnections).values({
            householdId: input.householdId, memberId: owner.id, userId: current.user.id,
            clientId: query.profile.client.clientId, issuer: urls.issuer, resource: urls.resource,
            grantedRole: owner.role, scopes: query.scopes, policyVersion: MCP_POLICY_VERSION,
            clientProfileVersion: query.profile.profile.version, adultAttestedAt: now, privacyAttestedAt: now,
            expiresAt: new Date(now.getTime() + TTL),
          }).returning();
          if (input.noteIds.length) await tx.insert(mcpNoteSelections).values(input.noteIds.map((noteId) => ({ householdId: input.householdId, connectionId: connection.id, noteId })));
          const [pending] = await tx.insert(mcpPendingConsents).values({
            householdId: input.householdId, connectionId: connection.id, userId: current.user.id, sessionId: current.session.id,
            clientId: connection.clientId, resource: urls.resource, queryHash: query.queryHash,
            expiresAt: new Date(Math.min(now.getTime() + 600_000, Number(new URLSearchParams(input.oauthQuery).get("exp")) * 1000)),
          }).onConflictDoNothing({ target: [mcpPendingConsents.sessionId, mcpPendingConsents.queryHash] }).returning({ id: mcpPendingConsents.id });
          if (!pending) deny("consent_already_prepared", 409);
          return { pendingId: pending.id, clientName: query.profile.client.name, scopes: connection.scopes, policyVersion: MCP_POLICY_VERSION };
        }));
      },
      async decideConsent(headers: Headers, input: { pendingId: string; oauthQuery: string; accept: boolean }) {
        uuid(input.pendingId);
        const current = await session(headers);
        const query = await checkedQuery(input.oauthQuery);
        // Consume before invoking the provider. A failed or uncertain issuance is never retried.
        const connection = await withUserLookupContext(db, current.user.id, async (lookup) => {
          const [pending] = await lookup.update(mcpPendingConsents).set({ consumedAt: new Date() }).where(and(
            eq(mcpPendingConsents.id, input.pendingId), eq(mcpPendingConsents.userId, current.user.id), eq(mcpPendingConsents.sessionId, current.session.id),
            eq(mcpPendingConsents.queryHash, query.queryHash), eq(mcpPendingConsents.clientId, query.profile.client.clientId),
            eq(mcpPendingConsents.resource, urls.resource), gt(mcpPendingConsents.expiresAt, new Date()), isNull(mcpPendingConsents.consumedAt),
          )).returning();
          if (!pending) deny("consent_expired_or_used", 409);
          return withHouseholdContext(lookup, pending.householdId, async (tx) => {
            const owner = await member(tx, current.user.id, pending.householdId);
            await householdAccess(tx, pending.householdId, query.scopes);
            const [connection] = await tx.update(mcpConnections).set(input.accept ? { status: "pending" } : { status: "revoked", revokedAt: new Date() }).where(and(
              eq(mcpConnections.id, pending.connectionId), eq(mcpConnections.userId, current.user.id), eq(mcpConnections.householdId, pending.householdId),
              eq(mcpConnections.status, "pending"), eq(mcpConnections.grantedRole, owner.role), eq(mcpConnections.clientProfileVersion, query.profile.profile.version),
            )).returning();
            if (!connection || !sameScopes(connection.scopes, query.scopes)) deny("consent_invalid", 409);
            return connection;
          });
        });
        if (!input.accept) return { accepted: false as const };
        let response: Response;
        try {
          response = await approval.run({ connection, sessionId: current.session.id }, () => auth.handler(new Request(urls.issuer + "/oauth2/consent", {
            method: "POST", headers: new Headers({ cookie: headers.get("cookie") ?? "", origin: urls.origin, "content-type": "application/json" }),
            body: JSON.stringify({ accept: true, oauth_query: input.oauthQuery }),
          })));
        } catch {
          await this.revokeConnection(headers, connection.id);
          deny("authorization_failed", 409);
        }
        const data = await response.json().catch(() => null) as { redirect_uri?: string; url?: string } | null;
        const redirect = response.headers.get("location") ?? data?.redirect_uri ?? data?.url;
        if (!response.ok || !redirect || !new URL(redirect, urls.origin).searchParams.has("code")) {
          await this.revokeConnection(headers, connection.id);
          deny("authorization_failed", 409);
        }
        await withUserLookupContext(db, current.user.id, (lookup) => withHouseholdContext(lookup, connection.householdId, async (tx) => {
          const [active] = await tx.update(mcpConnections).set({ status: "active", activatedAt: new Date() }).where(and(
            eq(mcpConnections.id, connection.id), eq(mcpConnections.userId, current.user.id), eq(mcpConnections.status, "pending"), gt(mcpConnections.expiresAt, new Date()),
          )).returning({ id: mcpConnections.id });
          if (!active) deny("authorization_failed", 409);
        }));
        return { accepted: true as const, redirectUri: redirect, connectionId: connection.id };
      },
      async authorize(request: Request, requiredScopes: readonly string[] = []) {
        if (!env.MCP_ENABLED || env.DEMO_MODE || !request.headers.get("authorization")?.match(/^Bearer [^\s]+$/i)) deny("unauthorized", 401);
        let payload;
        try { payload = await verify(request, { verifyOptions: { issuer: urls.issuer, audience: urls.resource, typ: "at+jwt", maxTokenAge: "5m", requiredClaims: ["sub", "exp", "iat", "client_id", "scope", "domi_grant_id"] } }); }
        catch { deny("invalid_token", 401); }
        if (typeof payload.sub !== "string" || typeof payload.domi_grant_id !== "string" || typeof payload.client_id !== "string" || typeof payload.scope !== "string") deny("invalid_token", 401);
        const audiences = typeof payload.aud === "string" ? [payload.aud] : payload.aud;
        if (!audiences || audiences.length !== 1 || audiences[0] !== urls.resource) deny("invalid_token", 401);
        if (typeof payload.exp !== "number" || typeof payload.iat !== "number" || payload.exp - payload.iat > 300) deny("invalid_token", 401);
        const scopes = payload.scope.split(" ").filter(Boolean);
        const connection = await liveConnection(payload.sub, payload.domi_grant_id, scopes, payload.client_id);
        if (requiredScopes.some((s) => !connection.scopes.includes(s) || !scopes.includes(s))) deny("insufficient_scope");
        return { userId: connection.userId, memberId: connection.memberId, householdId: connection.householdId, connectionId: connection.id, scopes };
      },
      async revokeConnection(headers: Headers, connectionId: string) {
        uuid(connectionId);
        const current = await session(headers);
        // Commit application denial first, independently of provider cleanup.
        await withMcpConnectionContext(db, current.user.id, connectionId, async (lookup) => {
          const [connection] = await lookup.select().from(mcpConnections).where(and(eq(mcpConnections.id, connectionId), eq(mcpConnections.userId, current.user.id))).limit(1);
          if (!connection) deny("connection_unavailable");
          await withHouseholdContext(lookup, connection.householdId, (tx) => tx.update(mcpConnections).set({ status: "revoked", revokedAt: new Date() }).where(and(eq(mcpConnections.id, connectionId), eq(mcpConnections.userId, current.user.id))));
        });
        try {
          await withMcpProviderContext(db, async (tx) => {
            await tx.update(oauthRefreshToken).set({ revoked: new Date() }).where(and(eq(oauthRefreshToken.referenceId, connectionId), eq(oauthRefreshToken.userId, current.user.id)));
            await tx.update(oauthAccessToken).set({ revoked: new Date() }).where(and(eq(oauthAccessToken.referenceId, connectionId), eq(oauthAccessToken.userId, current.user.id)));
            await tx.delete(oauthConsent).where(and(eq(oauthConsent.referenceId, connectionId), eq(oauthConsent.userId, current.user.id)));
          });
          return { revoked: true, providerCleanupComplete: true };
        } catch { return { revoked: true, providerCleanupComplete: false }; }
      },
      async setHouseholdEnabled(headers: Headers, householdId: string, enabled: boolean) {
        uuid(householdId);
        const current = await session(headers);
        return withUserLookupContext(db, current.user.id, (lookup) => withHouseholdContext(lookup, householdId, async (tx) => {
          const owner = await member(tx, current.user.id, householdId);
          if (!["owner", "admin"].includes(owner.role)) deny();
          await tx.insert(mcpHouseholdSettings).values({ householdId, enabled, updatedByMemberId: owner.id })
            .onConflictDoUpdate({ target: mcpHouseholdSettings.householdId, set: { enabled, updatedByMemberId: owner.id, updatedAt: new Date() } });
          return { enabled };
        }));
      },
    };
  } };
}

export type McpAuthorization = ReturnType<ReturnType<typeof createMcpAuthorization>["attach"]>;
