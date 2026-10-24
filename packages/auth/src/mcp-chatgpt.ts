import type { PublishedClientPolicy } from "./mcp-client-discovery.js";

export const CHATGPT_CLIENT_ID = "https://chatgpt.com/oauth/client.json";
export const CHATGPT_CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect";
export const CHATGPT_JWKS_URI = "https://chatgpt.com/oauth/jwks.json";
export const CHATGPT_POLICY: PublishedClientPolicy = { clientId: CHATGPT_CLIENT_ID, callback: CHATGPT_CALLBACK,
  provider: "chatgpt", version: "chatgpt.cimd.v1", displayName: "ChatGPT (chatgpt.com)",
  authMethod: "private_key_jwt", jwksUri: CHATGPT_JWKS_URI };
