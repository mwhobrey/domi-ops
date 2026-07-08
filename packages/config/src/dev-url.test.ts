import { describe, expect, it } from "vitest";
import {
  DEV_WEB_PORT_DOCKER,
  DEV_WEB_PORT_NATIVE,
  inferDevWebProfile,
  oauthRedirectUris,
  validateDevPublicAppUrl,
} from "./dev-url.js";

describe("dev-url", () => {
  it("infers native vs docker from port", () => {
    expect(inferDevWebProfile("http://localhost:3000")).toBe("native");
    expect(inferDevWebProfile("http://localhost:3001")).toBe("docker");
    expect(inferDevWebProfile("https://app.example.com")).toBe(null);
  });

  it("builds oauth redirect URIs from PUBLIC_APP_URL", () => {
    expect(oauthRedirectUris("http://localhost:3000/")).toEqual({
      login: "http://localhost:3000/auth/callback/google",
      calendar: "http://localhost:3000/auth/google/calendar/callback",
    });
  });

  it("warns when profile and port disagree", () => {
    const warnings = validateDevPublicAppUrl({
      nodeEnv: "development",
      publicAppUrl: "http://localhost:3001",
      devProfile: "native",
    });
    expect(warnings.some((w) => w.includes("DOMI_OPS_DEV_PROFILE=native"))).toBe(true);
  });

  it("skips validation outside development", () => {
    expect(
      validateDevPublicAppUrl({
        nodeEnv: "production",
        publicAppUrl: "http://localhost:3000",
        devProfile: "docker",
      }),
    ).toEqual([]);
  });

  it("documents canonical dev ports", () => {
    expect(DEV_WEB_PORT_NATIVE).toBe(3000);
    expect(DEV_WEB_PORT_DOCKER).toBe(3001);
  });
});
