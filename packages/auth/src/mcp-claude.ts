import { isPublishedClient, type PublishedClientPolicy } from "./mcp-client-discovery.js";

export const CLAUDE_CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
export const CLAUDE_PROFILE_VERSION = "claude.cimd.v1";
export const CLAUDE_POLICY: PublishedClientPolicy = { clientId: CLAUDE_CLIENT_ID, callback: CLAUDE_CALLBACK,
  provider: "claude", version: CLAUDE_PROFILE_VERSION, displayName: "Claude (claude.ai)", authMethod: "none" };
export function isClaudeClient(client: Parameters<typeof isPublishedClient>[0]) {
  return isPublishedClient(client, CLAUDE_POLICY);
}
export function claudeConnectUrl(origin: string) {
  return "https://claude.ai/customize/connectors?" + new URLSearchParams({
    modal: "add-custom-connector", connectorName: "Domi Ops", connectorUrl: origin + "/api/mcp",
  });
}
