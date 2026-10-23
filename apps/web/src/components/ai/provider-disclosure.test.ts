import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderDataDisclosure } from "./ProviderDataDisclosure";

describe("provider disclosure", () => {
  it("shows Gemini training/review/retention risks and source links before consent", () => {
    const html = renderToStaticMarkup(createElement(ProviderDataDisclosure, { provider: "gemini" }));
    expect(html).toContain("Gemini data-use risks");
    expect(html).toContain("Keep Activity");
    expect(html).toContain("train its models");
    expect(html).toContain("human reviewers");
    expect(html).toContain("three years");
    expect(html).toContain("https://support.google.com/gemini/answer/13594961?hl=en");
    expect(html).toContain("deny the connection");
    expect(html).toContain("cannot erase information");
  });
  it("keeps the shared transfer/disconnect disclosure for other providers", () => {
    const html = renderToStaticMarkup(createElement(ProviderDataDisclosure, { provider: "claude" }));
    expect(html).toContain("Your information leaves Domi Ops");
    expect(html).toContain("cannot enforce them");
    expect(html).not.toContain("Gemini data-use risks");
  });
});
