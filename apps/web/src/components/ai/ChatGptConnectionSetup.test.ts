import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatGptConnectionSetup } from "./ChatGptConnectionSetup.js";

describe("ChatGPT onboarding", () => {
  const options = { serverUrl: "https://home.example.test/api/mcp", setupUrl: "https://chatgpt.com/plugins" };
  it("offers no setup action before household enablement", () => {
    const html = renderToStaticMarkup(createElement(ChatGptConnectionSetup, { ...options, enabled: false }));
    expect(html).toContain("Enable AI connections for this household first");
    expect(html).not.toContain("href=");
  });
  it("shows the actual origin, OAuth and published identity without credentials", () => {
    const html = renderToStaticMarkup(createElement(ChatGptConnectionSetup, { ...options, enabled: true }));
    expect(html).toContain(options.serverUrl);
    expect(html).toContain("published identity (CIMD)");
    expect(html).toContain("Leave client credentials and request headers empty");
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("links the published ChatGPT directory listing for Domi Ops Cloud", () => {
    const html = renderToStaticMarkup(createElement(ChatGptConnectionSetup, { ...options, enabled: true }));
    expect(html).toContain("https://chatgpt.com/plugins/plugin_asdk_app_6ae0aba26a6481919c67125a963fa4f9");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("available in the ChatGPT plugin directory");
    expect(html).toContain("read-only for household shopping and chores on Domi Ops Cloud");
    expect(html).not.toContain("directory listing is still pending");
  });
});
