import { describe, expect, it } from "vitest";
import { CLAUDE_CALLBACK, CLAUDE_CLIENT_ID, claudeConnectUrl, isClaudeClient } from "./mcp-claude.js";

describe("Claude published identity", () => {
  const client = { clientId: CLAUDE_CLIENT_ID, clientDiscoveryId: "cimd", tokenEndpointAuthMethod: "none",
    requirePKCE: true, skipConsent: false, redirectUris: [CLAUDE_CALLBACK] };
  it("accepts only the exact discovery-owned public identity and callback", () => {
    expect(isClaudeClient(client)).toBe(true);
    for (const change of [
      { clientId: "https://claude.ai.attacker.test/oauth/mcp-oauth-client-metadata" },
      { clientDiscoveryId: null }, { tokenEndpointAuthMethod: "client_secret_basic" },
      { requirePKCE: false }, { skipConsent: true }, { redirectUris: undefined },
      { redirectUris: [CLAUDE_CALLBACK, "https://attacker.test/callback"] },
      { redirectUris: [CLAUDE_CALLBACK + "/"] },
    ]) expect(isClaudeClient({ ...client, ...change })).toBeFalsy();
  });
  it.each(["https://app.example.test", "https://home.example.test"])("prefills the deployment URL without credentials for %s", (origin) => {
    const link = new URL(claudeConnectUrl(origin));
    expect(link.origin + link.pathname).toBe("https://claude.ai/customize/connectors");
    expect(Object.fromEntries(link.searchParams)).toEqual({ modal: "add-custom-connector", connectorName: "Domi Ops", connectorUrl: origin + "/api/mcp" });
  });
});
