import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GrokBotConnectionSetup } from "./GrokBotConnectionSetup.js";
import { ProviderDataDisclosure } from "./ProviderDataDisclosure.js";

describe("Grok Bot onboarding boundaries", () => {
  it.each([["shopping:read"], ["chores:read"], ["shopping:read", "chores:read"]])("uses the deployment's enabled read scopes: %j", (...readScopes) => {
    const serverUrl = "https://selfhost.example.test/api/mcp";
    const scopes = [...readScopes, "offline_access"];
    const disabled = renderToStaticMarkup(createElement(GrokBotConnectionSetup, { enabled: false, serverUrl, scopes }));
    expect(disabled).toContain("Enable AI connections for this household first");
    expect(disabled).not.toContain("Authenticate");
    const enabled = renderToStaticMarkup(createElement(GrokBotConnectionSetup, { enabled: true, serverUrl, scopes }));
    expect(enabled).toContain(serverUrl);
    expect(enabled).toContain("Stop if it asks for notes or write access");
    expect(enabled).toContain("Cursor cloud identity");
    expect(enabled).toContain("https://cursor.com/oauth/mcp-client.json");
    expect(enabled).toContain(scopes.join(" "));
    for (const scope of ["shopping:read", "chores:read"].filter(scope => !readScopes.includes(scope))) expect(enabled).not.toContain(scope);
    expect(enabled).toContain("Do not use automatic client registration");
    expect(enabled).toContain("Directory listing is pending");
  });
  it("discloses account-wide availability and distinguishes MCP from browser access", () => {
    const html = renderToStaticMarkup(createElement(ProviderDataDisclosure, { provider: "grok-bot" }));
    expect(html).toContain("every Bot on your account");
    expect(html).toContain("Cloud storage is required");
    expect(html).toContain("does not give a Bot a browser login");
    expect(html).toContain('href="https://cursor.com/privacy"');
    expect(html).toContain("cannot erase information already copied");
  });
});
