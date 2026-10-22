import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxyAuthToApi } from "./auth-proxy";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("OAuth browser navigation through the auth proxy", () => {
  function upstream(url: string) {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "first=1; Path=/; HttpOnly");
    headers.append("set-cookie", "second=2; Path=/; HttpOnly");
    const fetch = vi.fn().mockResolvedValue(Response.json({ redirect: true, url }, { headers }));
    vi.stubGlobal("fetch", fetch); vi.stubEnv("API_URL", "http://api.internal:4000");
    return fetch;
  }
  it.each([["oauth2", "authorize"], ["callback", "google"]])("redirects a real navigation and preserves each Set-Cookie: %j", async (...segments) => {
    const fetch = upstream("/ai/consent?sig=signed&ba_param=scope&scope=notes%3Aread");
    const request = new NextRequest("https://app.example.test/auth/" + segments.join("/"), { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } });
    const response = await proxyAuthToApi(request, segments);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/ai/consent?sig=signed&ba_param=scope&scope=notes%3Aread");
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(new Headers(fetch.mock.calls[0][1].headers).get("sec-fetch-mode")).toBe("navigate");
  });
  it("keeps the JSON contract for AJAX so the maintained auth client can redirect", async () => {
    upstream("/ai/consent?sig=signed");
    const response = await proxyAuthToApi(new NextRequest("https://app.example.test/auth/oauth2/authorize", { headers: { "sec-fetch-mode": "cors" } }), ["oauth2", "authorize"]);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ redirect: true });
  });
  it("does not turn an untrusted origin into a proxy redirect", async () => {
    upstream("https://foreign.test/steal");
    const response = await proxyAuthToApi(new NextRequest("https://app.example.test/auth/oauth2/authorize", { headers: { "sec-fetch-mode": "navigate" } }), ["oauth2", "authorize"]);
    expect(response.status).toBe(200); expect(response.headers.has("location")).toBe(false);
  });
});
