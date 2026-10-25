import { describe, expect, it } from "vitest";
import { isPublishedClient } from "./mcp-client-discovery.js";
import { CHATGPT_POLICY } from "./mcp-chatgpt.js";

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
