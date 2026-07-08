import { describe, expect, it } from "vitest";
import {
  filterActiveHouseholdModules,
  householdModuleCeiling,
  isDriveQuotaEnforced,
  isHostedDeployment,
  isModuleEnabledForHousehold,
  normalizeHouseholdModulesSelection,
  type Env,
} from "./index.js";

const baseEnv = {
  NODE_ENV: "development",
  PUBLIC_APP_URL: "http://localhost:3000",
  API_URL: "http://localhost:4000",
  DATABASE_URL: "postgresql://domi_ops:domi_ops@localhost:5432/domi_ops",
  MODULES_ENABLED: ["core", "school", "calendar_sync", "drive", "health"],
  DEPLOYMENT_MODE: "single",
  AUTH_REQUIRED: true,
  ALLOW_PUBLIC_SIGNUP: true,
  REDIS_URL: undefined,
  S3_REGION: "us-east-1",
  S3_BUCKET: "domi-ops",
  GOOGLE_CALENDAR_DEFAULT_SYNC_MODE: "import_only",
  DRIVE_UPLOAD_MAX_BYTES: 10_485_760,
  DRIVE_QUOTA_ENFORCE: false,
  DRIVE_DEFAULT_QUOTA_BYTES: null,
  DRIVE_QUOTA_WARN_PERCENT: 90,
  DRIVE_PUBLIC_SHARES_ENABLED: true,
  DEMO_HOUSEHOLD_SLUG: "rivera-demo",
} as Env;

describe("isHostedDeployment", () => {
  it("treats shared and dedicated as hosted", () => {
    expect(isHostedDeployment({ ...baseEnv, DEPLOYMENT_MODE: "shared" })).toBe(true);
    expect(isHostedDeployment({ ...baseEnv, DEPLOYMENT_MODE: "dedicated" })).toBe(true);
    expect(isHostedDeployment(baseEnv)).toBe(false);
  });
});

describe("householdModuleCeiling", () => {
  it("ignores entitlements on self-host", () => {
    expect(householdModuleCeiling(baseEnv, ["core", "school"])).toEqual([
      "core",
      "school",
      "calendar_sync",
      "drive",
      "health",
    ]);
  });

  it("intersects deploy catalog with entitlements on hosted", () => {
    const env = { ...baseEnv, DEPLOYMENT_MODE: "shared" as const };
    expect(householdModuleCeiling(env, ["core", "school", "drive"])).toEqual([
      "core",
      "school",
      "drive",
    ]);
  });
});

describe("isModuleEnabledForHousehold", () => {
  it("blocks modules outside entitlements on hosted", () => {
    const env = { ...baseEnv, DEPLOYMENT_MODE: "shared" as const };
    const household = ["core", "school", "drive"];
    expect(isModuleEnabledForHousehold(env, household, "drive", ["core", "school"])).toBe(
      false,
    );
    expect(isModuleEnabledForHousehold(env, household, "school", ["core", "school"])).toBe(
      true,
    );
  });
});

describe("filterActiveHouseholdModules", () => {
  it("returns only entitled active modules on hosted", () => {
    const env = { ...baseEnv, DEPLOYMENT_MODE: "shared" as const };
    expect(
      filterActiveHouseholdModules(env, ["core", "school", "drive"], ["core", "school"]),
    ).toEqual(["core", "school"]);
  });
});

describe("normalizeHouseholdModulesSelection", () => {
  it("rejects modules above ceiling", () => {
    expect(
      normalizeHouseholdModulesSelection(["core", "drive"], ["core", "school"]),
    ).toBeNull();
    expect(normalizeHouseholdModulesSelection(["core", "school"], ["core", "school"])).toEqual([
      "core",
      "school",
    ]);
  });
});

describe("isDriveQuotaEnforced", () => {
  it("enforces on hosted even when env flag is off", () => {
    expect(isDriveQuotaEnforced({ ...baseEnv, DRIVE_QUOTA_ENFORCE: false })).toBe(false);
    expect(
      isDriveQuotaEnforced({
        ...baseEnv,
        DEPLOYMENT_MODE: "shared",
        DRIVE_QUOTA_ENFORCE: false,
      }),
    ).toBe(true);
  });
});
