import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClaudeConnectionSetup } from "./ClaudeConnectionSetup.js";

describe("Claude connection setup", () => {
  const options = { connectUrl: "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorUrl=https%3A%2F%2Fhousehold.example.test%2Fapi%2Fmcp", serverUrl: "https://household.example.test/api/mcp" };
  it("offers no connection action until the household is enabled", () => {
    const html = renderToStaticMarkup(createElement(ClaudeConnectionSetup, { ...options, enabled: false }));
    expect(html).toContain("Enable AI connections for this household first");
    expect(html).not.toContain("href=");
  });
  it("shows the actual server, consent boundary and isolated external link", () => {
    const html = renderToStaticMarkup(createElement(ClaudeConnectionSetup, { ...options, enabled: true }));
    expect(html).toContain(options.serverUrl);
    expect(html).toContain("review permissions before any information is shared");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("MCP_CLAUDE_ENABLED");
  });
});
