import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GrokBotConnectionSetup } from "./GrokBotConnectionSetup.js";
import { ProviderDataDisclosure } from "./ProviderDataDisclosure.js";

describe("Grok Bot onboarding boundaries", () => {
  it("gates household setup and identifies the actual endpoint and shared cloud identity", () => {
    const serverUrl = "https://selfhost.example.test/api/mcp";
    const disabled = renderToStaticMarkup(createElement(GrokBotConnectionSetup, { enabled: false, serverUrl }));
    expect(disabled).toContain("Enable AI connections for this household first");
    expect(disabled).not.toContain("Authenticate");
    const enabled = renderToStaticMarkup(createElement(GrokBotConnectionSetup, { enabled: true, serverUrl }));
    expect(enabled).toContain(serverUrl);
    expect(enabled).toContain("Stop if it asks for notes or write access");
    expect(enabled).toContain("Cursor cloud identity");
    expect(enabled).toContain("https://cursor.com/oauth/mcp-client.json");
    expect(enabled).toContain("shopping:read chores:read offline_access");
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
