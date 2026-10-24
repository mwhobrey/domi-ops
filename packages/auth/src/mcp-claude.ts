import { createCimdClientDiscovery } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import { and, eq, isNull } from "drizzle-orm";
import type { Env } from "@domi-ops/config";
import { mcpClientProfiles, oauthClient, withMcpProviderContext, type Database } from "@domi-ops/db";

export const CLAUDE_CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
export const CLAUDE_PROFILE_VERSION = "claude.cimd.v1";

export function isClaudeClient(client: {
  clientId: string; clientDiscoveryId?: string | null; tokenEndpointAuthMethod?: string | null;
  requirePKCE?: boolean | null; skipConsent?: boolean | null; redirectUris?: string[] | null;
}) {
  return client.clientId === CLAUDE_CLIENT_ID && client.clientDiscoveryId === "cimd" &&
    client.tokenEndpointAuthMethod === "none" && client.requirePKCE && !client.skipConsent &&
    client.redirectUris?.length === 1 && client.redirectUris[0] === CLAUDE_CALLBACK;
}

export function claudeConnectUrl(origin: string) {
  return "https://claude.ai/customize/connectors?" + new URLSearchParams({
    modal: "add-custom-connector", connectorName: "Domi Ops", connectorUrl: origin + "/api/mcp",
  });
}

export function claudeDiscovery(db: Database, env: Env, transport: ClientMetadataResourceFetch = fetchClientMetadataResource) {
  const discovery = createCimdClientDiscovery({
    metadataProfile: "mcp-2026-07-28",
    maxCacheEntries: 1,
    metadataRevalidationInterval: "5m",
    isMetadataDocumentUrlAllowed: (url) => url === CLAUDE_CLIENT_ID,
    fetchClientMetadataResource: (input, init) => {
      // No metadata-owned secondary URL may expand the operator-approved network boundary.
      if (String(input) !== CLAUDE_CLIENT_ID) throw new Error("unapproved_client_metadata_resource");
      return transport(input, init);
    },
  });
  return {
    ...discovery,
    async resolve(...args: Parameters<typeof discovery.resolve>) {
      if (args[1] !== CLAUDE_CLIENT_ID) throw new APIError("BAD_REQUEST", { error: "invalid_client" });
      const client = await discovery.resolve(...args);
      if (!client || client.requirePKCE === false || !isClaudeClient({ ...client, requirePKCE: true })) throw new APIError("BAD_REQUEST", { error: "invalid_client" });
      // The document establishes identity only. Local policy owns provider, version and consent.
      await withMcpProviderContext(db, async (tx) => {
        // Public clients already require PKCE upstream; persist that local requirement too.
        await tx.update(oauthClient).set({ requirePKCE: true }).where(and(eq(oauthClient.clientId, CLAUDE_CLIENT_ID),
          eq(oauthClient.clientDiscoveryId, "cimd"), isNull(oauthClient.requirePKCE)));
        const [current] = await tx.select().from(oauthClient).where(eq(oauthClient.clientId, CLAUDE_CLIENT_ID));
        if (!current || !isClaudeClient(current)) throw new APIError("BAD_REQUEST", { error: "invalid_client" });
        await tx.insert(mcpClientProfiles).values({
          clientId: CLAUDE_CLIENT_ID, provider: "claude", version: CLAUDE_PROFILE_VERSION,
          dataMode: env.MCP_SYNTHETIC_DEPLOYMENT ? "synthetic" : "household", enabled: true,
        }).onConflictDoNothing();
      });
      return { ...client, requirePKCE: true };
    },
  };
}
