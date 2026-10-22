import { describe, expect, it } from "vitest";
import { assistantConsentPath, assistantLoginRedirect } from "./mcp";

const signed = "sig=example&ba_param=state&ba_param=client_id&state=one&client_id=approved";
describe("assistant browser login continuation", () => {
  it("preserves signed fields and excludes unsigned navigation", () => {
    const path = assistantConsentPath(new URLSearchParams(signed + "&next=https%3A%2F%2Fforeign.test&error=ignored"));
    expect(path).toBe("/ai/consent?" + signed);
  });
  it("does not treat ordinary login, duplicated signatures or oversized queries as consent", () => {
    expect(assistantConsentPath(new URLSearchParams("next=/profile"))).toBeNull();
    expect(assistantConsentPath(new URLSearchParams(signed + "&sig=two"))).toBeNull();
    expect(assistantConsentPath(new URLSearchParams(signed + "&state=" + "a".repeat(12000)))).toBeNull();
  });
  it("uses the provider-returned signed consent destination", () => {
    expect(assistantLoginRedirect({ url: "/ai/consent?" + signed }, "https://domi.test")).toBe("https://domi.test/ai/consent?" + signed);
    expect(assistantLoginRedirect({ redirect_uri: "https://domi.test/ai/consent?" + signed }, "https://domi.test")).toContain("/ai/consent?");
  });
  it.each([undefined, { url: "https://foreign.test/ai/consent?" + signed }, { url: "javascript:alert(1)" }, { url: "/dashboard" }, { url: "/ai/consent?unsigned=1" }])("rejects an invalid continuation: %j", (value) => {
    expect(() => assistantLoginRedirect(value, "https://domi.test")).toThrow();
  });
});
