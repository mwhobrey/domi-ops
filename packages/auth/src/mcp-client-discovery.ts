import { createCimdClientDiscovery } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import { and, eq, isNull } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { mcpClientProfiles, oauthClient, withMcpProviderContext, type Database } from "@domi-ops/db";

export type PublishedClientPolicy = {
  clientId: string; callback: string; provider: "claude" | "chatgpt" | "grok-bot"; version: string;
  displayName: string; authMethod: "none" | "private_key_jwt"; jwksUri?: string;
  metadataRedirectUris?: readonly string[]; allowedScopes?: readonly string[];
};
type Client = {
  clientId: string; clientDiscoveryId?: string | null; tokenEndpointAuthMethod?: string | null;
  requirePKCE?: boolean | null; skipConsent?: boolean | null; redirectUris?: string[] | null;
  jwksUri?: string | null; jwks?: unknown;
};
export function isPublishedClient(client: Client, policy: PublishedClientPolicy) {
  const redirects = policy.metadataRedirectUris ?? [policy.callback];
  return client.clientId === policy.clientId && client.clientDiscoveryId === "cimd" &&
    client.tokenEndpointAuthMethod === policy.authMethod && client.requirePKCE && !client.skipConsent &&
    redirects.includes(policy.callback) && client.redirectUris?.length === redirects.length &&
    new Set(client.redirectUris).size === redirects.length && client.redirectUris.every(uri => redirects.includes(uri)) &&
    (policy.authMethod === "none" || (client.jwksUri === policy.jwksUri && !client.jwks));
}

export function publishedClientDiscovery(db: Database, env: Env, policies: PublishedClientPolicy[], transport: ClientMetadataResourceFetch = fetchClientMetadataResource) {
  const allowed = new Set(policies.flatMap((policy) => [policy.clientId, ...(policy.jwksUri ? [policy.jwksUri] : [])]));
  const discovery = createCimdClientDiscovery({
    metadataProfile: "mcp-2026-07-28", maxCacheEntries: policies.length, metadataRevalidationInterval: "5m",
    isMetadataDocumentUrlAllowed: (url) => policies.some((policy) => policy.clientId === url),
    fetchClientMetadataResource: (input, init) => {
      // Metadata cannot expand this operator-approved identity/key network boundary.
      if (!allowed.has(String(input))) throw new Error("unapproved_client_metadata_resource");
      return transport(input, init);
    },
  });
  return {
    ...discovery,
    async resolve(...args: Parameters<typeof discovery.resolve>) {
      const policy = policies.find((entry) => entry.clientId === args[1]);
      if (!policy) throw new APIError("BAD_REQUEST", { error: "invalid_client" });
      const client = await discovery.resolve(...args);
      if (!client || client.requirePKCE === false || !isPublishedClient({ ...client, requirePKCE: true }, policy)) throw new APIError("BAD_REQUEST", { error: "invalid_client" });
      // Discovery establishes identity only; local policy owns consent and provider binding.
      await withMcpProviderContext(db, async (tx) => {
        await tx.update(oauthClient).set({ requirePKCE: true }).where(and(eq(oauthClient.clientId, policy.clientId),
          eq(oauthClient.clientDiscoveryId, "cimd"), isNull(oauthClient.requirePKCE)));
        const [current] = await tx.select().from(oauthClient).where(eq(oauthClient.clientId, policy.clientId));
        if (!current || !isPublishedClient(current, policy)) throw new APIError("BAD_REQUEST", { error: "invalid_client" });
        await tx.insert(mcpClientProfiles).values({ clientId: policy.clientId, provider: policy.provider,
          version: policy.version, dataMode: env.MCP_SYNTHETIC_DEPLOYMENT ? "synthetic" : "household", enabled: true }).onConflictDoNothing();
      });
      return { ...client, requirePKCE: true };
    },
  };
}
