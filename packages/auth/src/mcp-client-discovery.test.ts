import { describe, expect, it } from "vitest";
import { isPublishedClient } from "./mcp-client-discovery.js";
import { CHATGPT_POLICY } from "./mcp-chatgpt.js";
import { GROK_BOT_POLICY, GROK_BOT_METADATA_CALLBACKS } from "./mcp-grok-bot.js";

describe("ChatGPT published identity policy", () => {
  const client = { clientId: CHATGPT_POLICY.clientId, clientDiscoveryId: "cimd", tokenEndpointAuthMethod: "private_key_jwt",
    requirePKCE: true, skipConsent: false, redirectUris: [CHATGPT_POLICY.callback], jwksUri: CHATGPT_POLICY.jwksUri };
  it("requires the exact identity, callback, signing method and managed key URL", () => {
    expect(isPublishedClient(client, CHATGPT_POLICY)).toBe(true);
    for (const change of [{ clientId: client.clientId + "?copy=1" }, { clientDiscoveryId: null }, { tokenEndpointAuthMethod: "none" },
      { redirectUris: [CHATGPT_POLICY.callback, "https://attacker.test/callback"] }, { jwksUri: "https://chatgpt.com/other-keys.json" },
      { jwks: { keys: [] } }, { requirePKCE: false }, { skipConsent: true }]) expect(isPublishedClient({ ...client, ...change }, CHATGPT_POLICY)).toBeFalsy();
  });
});

describe("Grok Bot shared cloud identity", () => {
  const client = { clientId: GROK_BOT_POLICY.clientId, clientDiscoveryId: "cimd", tokenEndpointAuthMethod: "none",
    requirePKCE: true, skipConsent: false, redirectUris: [...GROK_BOT_METADATA_CALLBACKS] };
  it("pins the complete metadata redirect set without approving other product callbacks", () => {
    expect(isPublishedClient(client, GROK_BOT_POLICY)).toBe(true);
    expect(isPublishedClient({ ...client, redirectUris: [...client.redirectUris].reverse() }, GROK_BOT_POLICY)).toBe(true);
    for (const change of [{ clientId: client.clientId + "?copy=1" }, { clientDiscoveryId: null }, { requirePKCE: false },
      { skipConsent: true }, { tokenEndpointAuthMethod: "client_secret_post" }, { redirectUris: [GROK_BOT_POLICY.callback] },
      { redirectUris: [...client.redirectUris, "https://attacker.test/callback"] }, { redirectUris: client.redirectUris.map(() => GROK_BOT_POLICY.callback) }]) {
      expect(isPublishedClient({ ...client, ...change }, GROK_BOT_POLICY)).toBeFalsy();
    }
  });
});
