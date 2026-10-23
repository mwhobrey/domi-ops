import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiRegistration } from "./registration.mjs";

test("Gemini registration retains one exact Google callback and the synthetic-only profile", () => {
  const callback = "https://oauth-redirect.googleusercontent.com/r/fictional-test-partner";
  const profile = geminiRegistration(callback);
  assert.deepEqual(profile.redirectUris, [callback]);
  assert.equal(profile.provider, "gemini"); assert.equal(profile.dataMode, "synthetic");
  assert.equal(profile.tokenEndpointAuthMethod, "none");
  assert.deepEqual(profile.scopes, ["shopping:read", "chores:read", "notes:read", "offline_access"]);
});

test("Gemini callback rejects lookalike hosts, sandbox, wildcards and extra URL components", () => {
  for (const callback of [
    "https://oauth-redirect.googleusercontent.com.evil.test/r/partner",
    "https://oauth-redirect-sandbox.googleusercontent.com/r/partner",
    "http://oauth-redirect.googleusercontent.com/r/partner",
    "https://user:pass@oauth-redirect.googleusercontent.com/r/partner",
    "https://oauth-redirect.googleusercontent.com/r/*",
    "https://oauth-redirect.googleusercontent.com/r/partner?token=secret",
    "https://oauth-redirect.googleusercontent.com/r/partner#fragment",
    "https://oauth-redirect.googleusercontent.com/r/partner/other",
    "https://oauth-redirect.googleusercontent.com/r/",
    "https://synthetic.example.test/api/mcp",
  ]) assert.throws(() => geminiRegistration(callback));
});
