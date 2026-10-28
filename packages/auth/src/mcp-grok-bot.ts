import type { PublishedClientPolicy } from "./mcp-client-discovery.js";

export const GROK_BOT_CLIENT_ID = "https://cursor.com/oauth/mcp-client.json";
export const GROK_BOT_CALLBACK = "https://www.cursor.com/agents/mcp/oauth/callback";
// The published identity is shared across products; only the cloud callback is approved here.
export const GROK_BOT_METADATA_CALLBACKS = [GROK_BOT_CALLBACK,
  "https://www.cursor.com/bot/mcp/oauth/callback", "https://grok.com/connectors-oauth-exchange-code/",
  "http://localhost:8787/callback", "http://127.0.0.1:8787/callback"] as const;
export const GROK_BOT_POLICY: PublishedClientPolicy = { clientId: GROK_BOT_CLIENT_ID, callback: GROK_BOT_CALLBACK,
  metadataRedirectUris: GROK_BOT_METADATA_CALLBACKS, allowedScopes: ["shopping:read", "chores:read", "offline_access"],
  provider: "grok-bot", version: "grok-bot.cursor-cloud.v1", displayName: "Grok Bot / Cursor cloud", authMethod: "none" };
