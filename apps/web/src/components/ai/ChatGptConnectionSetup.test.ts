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
});
