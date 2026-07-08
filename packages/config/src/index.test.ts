import { describe, expect, it } from "vitest";
import {
  deployAvailableModules,
  envSchema,
  KNOWN_HOUSEHOLD_MODULES,
  loadEnv,
  resetEnvCache,
} from "./index.js";

describe("loadEnv", () => {
  it("rejects production without SESSION_SECRET and ENCRYPTION_KEY", () => {
    resetEnvCache();
    const parsed = envSchema.safeParse({
      NODE_ENV: "production",
      PUBLIC_APP_URL: "https://app.example.com",
      API_URL: "https://api.example.com",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      MODULES_ENABLED: "core",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("SESSION_SECRET");
      expect(paths).toContain("ENCRYPTION_KEY");
    }
  });

  it("parses development env", () => {
    resetEnvCache();
    const env = loadEnv({
      NODE_ENV: "development",
      PUBLIC_APP_URL: "http://localhost:3001",
      API_URL: "http://localhost:4000",
      DATABASE_URL: "postgresql://domi_ops:domi_ops@localhost:5432/domi_ops",
    });
    expect(env.MODULES_ENABLED).toContain("core");
    expect(env.GOOGLE_CALENDAR_DEFAULT_SYNC_MODE).toBe("import_only");
  });

  it("includes missing known modules in development catalog", () => {
    resetEnvCache();
    const env = loadEnv({
      NODE_ENV: "development",
      PUBLIC_APP_URL: "http://localhost:3001",
      API_URL: "http://localhost:4000",
      DATABASE_URL: "postgresql://domi_ops:domi_ops@localhost:5432/domi_ops",
      MODULES_ENABLED: "core,school,calendar_sync",
    });
    expect(env.MODULES_ENABLED).toContain("drive");
    expect(deployAvailableModules(env.MODULES_ENABLED)).toEqual([...KNOWN_HOUSEHOLD_MODULES]);
  });

  it("defaults ALLOW_PUBLIC_SIGNUP off in production, on in development", () => {
    resetEnvCache();
    const prod = loadEnv({
      NODE_ENV: "production",
      PUBLIC_APP_URL: "https://app.example.com",
      API_URL: "https://api.example.com",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      SESSION_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: "y".repeat(32),
      MODULES_ENABLED: "core",
    });
    expect(prod.ALLOW_PUBLIC_SIGNUP).toBe(false);

    resetEnvCache();
    const dev = loadEnv({
      NODE_ENV: "development",
      PUBLIC_APP_URL: "http://localhost:3000",
      API_URL: "http://localhost:4000",
      DATABASE_URL: "postgresql://domi_ops:domi_ops@localhost:5432/domi_ops",
    });
    expect(dev.ALLOW_PUBLIC_SIGNUP).toBe(true);
  });

  it("does not expand module catalog in production", () => {
    resetEnvCache();
    const env = loadEnv({
      NODE_ENV: "production",
      PUBLIC_APP_URL: "https://app.example.com",
      API_URL: "https://api.example.com",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      SESSION_SECRET: "x".repeat(32),
      ENCRYPTION_KEY: "y".repeat(32),
      MODULES_ENABLED: "core,school",
    });
    expect(env.MODULES_ENABLED).not.toContain("drive");
    expect(deployAvailableModules(env.MODULES_ENABLED)).toEqual(["core", "school"]);
  });
});
