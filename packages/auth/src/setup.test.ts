import { describe, expect, it } from "vitest";
import type { Env } from "@domi-ops/config";
import {
  hasSetupAccess,
  signSetupGrant,
  verifySetupGrant,
  verifySetupToken,
} from "./setup.js";

const baseEnv = {
  ALLOW_PUBLIC_SIGNUP: false,
  DEMO_MODE: false,
  SETUP_TOKEN: "test-setup-token-16chars",
  SESSION_SECRET: "x".repeat(32),
} as Env;

describe("verifySetupToken", () => {
  it("accepts matching token", () => {
    expect(verifySetupToken(baseEnv, "test-setup-token-16chars")).toBe(true);
  });

  it("rejects wrong token", () => {
    expect(verifySetupToken(baseEnv, "wrong-token-value!!")).toBe(false);
  });
});

describe("setup grant cookie", () => {
  it("round-trips signed grant", () => {
    const grant = signSetupGrant(baseEnv.SESSION_SECRET!);
    expect(verifySetupGrant(baseEnv.SESSION_SECRET!, grant)).toBe(true);
  });
});

describe("hasSetupAccess", () => {
  it("allows header token", () => {
    expect(
      hasSetupAccess(baseEnv, { headerToken: "test-setup-token-16chars", grantCookie: null }),
    ).toBe(true);
  });

  it("denies without token or grant", () => {
    expect(hasSetupAccess(baseEnv, { headerToken: null, grantCookie: null })).toBe(false);
  });
});
