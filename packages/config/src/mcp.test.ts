import { describe, expect, it } from "vitest";
import { envSchema } from "./index.js";

const base = { NODE_ENV: "test", PUBLIC_APP_URL: "https://selfhost.example.test", API_URL: "http://api:4000", DATABASE_URL: "postgres://fixture:fixture@localhost/fixture" };
describe("MCP deployment configuration", () => {
  it.each(["single", "shared", "dedicated"])("is opt-in and has no hosted license requirement in %s", (mode) => {
    const off = envSchema.parse({ ...base, DEPLOYMENT_MODE: mode });
    expect(off.MCP_ENABLED).toBe(false); expect(off.MCP_SYNTHETIC_DEPLOYMENT).toBe(false);
    expect(envSchema.parse({ ...base, DEPLOYMENT_MODE: mode, MCP_ENABLED: "true" }).MCP_ENABLED).toBe(true);
  });
  it.each(["http://lan.example.test", "https://example.test/prefix", "https://user:password@example.test", "https://example.test?query=1"])("rejects an unsafe issuer origin: %s", (origin) => {
    expect(envSchema.safeParse({ ...base, MCP_ENABLED: "true", PUBLIC_APP_URL: origin }).success).toBe(false);
  });
  it("permits HTTP loopback only outside production", () => {
    expect(envSchema.safeParse({ ...base, MCP_ENABLED: "true", PUBLIC_APP_URL: "http://127.0.0.1:4000" }).success).toBe(true);
    expect(envSchema.safeParse({ ...base, NODE_ENV: "production", MCP_ENABLED: "true", PUBLIC_APP_URL: "http://127.0.0.1:4000", SESSION_SECRET: "x".repeat(32), ENCRYPTION_KEY: "y".repeat(32) }).success).toBe(false);
  });
});
