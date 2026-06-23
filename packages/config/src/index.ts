import { z } from "zod";
import { validateDevPublicAppUrl, oauthRedirectUris, inferDevWebProfile } from "./dev-url.js";
import { loadRootDotenv, resetRootDotenvFlag } from "./load-dotenv.js";

export { loadRootDotenv, resetRootDotenvFlag } from "./load-dotenv.js";

export {
  DEV_WEB_PORT_DOCKER,
  DEV_WEB_PORT_NATIVE,
  devLoopbackOrigins,
  inferDevWebProfile,
  oauthRedirectUris,
  validateDevPublicAppUrl,
  type DevWebProfile,
} from "./dev-url.js";

const deploymentMode = z.enum(["single", "shared", "dedicated"]);
const syncMode = z.enum(["import_only", "manual", "bidirectional"]);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PUBLIC_APP_URL: z.string().url(),
    API_URL: z.string().url(),
    AUTH_REQUIRED: z
      .string()
      .optional()
      .transform((v) => v !== "false" && v !== "0"),
    /** Public email/password owner sign-up. Unset: true in development, false in production. */
    ALLOW_PUBLIC_SIGNUP: z
      .string()
      .optional()
      .transform((v): boolean | undefined => {
        if (v === "true" || v === "1") return true;
        if (v === "false" || v === "0") return false;
        return undefined;
      }),
    SESSION_SECRET: z.string().min(32).optional(),
    ENCRYPTION_KEY: z.string().min(16).optional(),
    DATABASE_URL: z.string().url(),
    DEPLOYMENT_MODE: deploymentMode.default("single"),
    REDIS_URL: z.string().url().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("us-east-1"),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_BUCKET: z.string().default("whome"),
    S3_FORCE_PATH_STYLE: z
      .string()
      .optional()
      .transform((v) => v === "true" || v === "1"),
    S3_PUBLIC_URL: z.string().url().optional(),
    /** Optional override for presigned browser uploads (defaults from S3_PUBLIC_URL). */
    S3_PUBLIC_ENDPOINT: z.string().url().optional(),
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
    GOOGLE_CALENDAR_DEFAULT_SYNC_MODE: syncMode.default("import_only"),
    MODULES_ENABLED: z
      .string()
      .default("core,school,calendar_sync,drive,health")
      .transform((s) =>
        s
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
      ),
    /** Per-file upload cap for Drive presign (bytes). Default 10 MB. */
    DRIVE_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),
    /** Phase 2: hard-block uploads at quota. Phase 1 tracks bytes only. */
    DRIVE_QUOTA_ENFORCE: z
      .string()
      .optional()
      .transform((v) => v === "true" || v === "1"),
    /** Default household storage quota on bootstrap (bytes). Set null/0 for unlimited self-host. */
    DRIVE_DEFAULT_QUOTA_BYTES: z
      .string()
      .default("10737418240")
      .transform((v) => {
        if (!v || v === "null" || v === "0") return null;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
      }),
    /** Warn threshold percent for settings storage meter. */
    DRIVE_QUOTA_WARN_PERCENT: z.coerce.number().int().min(1).max(100).default(90),
    /** Allow public share links (`GET /s/:token`). Self-host can disable. */
    DRIVE_PUBLIC_SHARES_ENABLED: z
      .string()
      .optional()
      .transform((v) => v !== "false" && v !== "0"),
    /** Legacy display name → Google email, e.g. Mom:mom@gmail.com,Dad:dad@gmail.com */
    HOUSEHOLD_MEMBER_EMAIL_MAP: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().email().optional(),
    EMAIL_VERIFICATION_REQUIRED: z
      .string()
      .optional()
      .transform((v) => v === "true" || v === "1"),
    /** Local dev: native (npm run dev :3000) or docker (compose web :3001) — validates PUBLIC_APP_URL in development */
    WHOME_DEV_PROFILE: z.enum(["native", "docker"]).optional(),
    /** Open-Meteo forecast (optional dashboard weather widget) */
    WEATHER_LATITUDE: z.string().optional(),
    WEATHER_LONGITUDE: z.string().optional(),
    WEATHER_LOCATION_LABEL: z.string().max(64).optional(),
    /** Web Push (VAPID) — optional; notice push disabled when unset */
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === "production") {
      if (!data.SESSION_SECRET || data.SESSION_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SESSION_SECRET (min 32 chars) is required in production",
          path: ["SESSION_SECRET"],
        });
      }
      if (!data.ENCRYPTION_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "ENCRYPTION_KEY is required in production (OAuth token encryption)",
          path: ["ENCRYPTION_KEY"],
        });
      }
      if (data.AUTH_REQUIRED === false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "AUTH_REQUIRED cannot be disabled in production",
          path: ["AUTH_REQUIRED"],
        });
      }
    }
    const calendarSync = data.MODULES_ENABLED.includes("calendar_sync");
    if (calendarSync && data.NODE_ENV === "production") {
      if (!data.GOOGLE_OAUTH_CLIENT_ID || !data.GOOGLE_OAUTH_CLIENT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Google OAuth credentials required when calendar_sync module is enabled",
          path: ["GOOGLE_OAUTH_CLIENT_ID"],
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export const KNOWN_HOUSEHOLD_MODULES = ["core", "school", "calendar_sync", "drive", "health"] as const;

/** Deploy catalog ∩ known modules — used for household settings `availableModules`. */
export function deployAvailableModules(envModules: readonly string[]): string[] {
  return KNOWN_HOUSEHOLD_MODULES.filter((m) => envModules.includes(m));
}

/** In development, include all known modules so stale `.env` catalogs still list new modules. */
function ensureDevModuleCatalog(nodeEnv: string, modulesEnabled: string[]): string[] {
  if (nodeEnv !== "development") return modulesEnabled;
  const missing = KNOWN_HOUSEHOLD_MODULES.filter((m) => !modulesEnabled.includes(m));
  if (missing.length === 0) return modulesEnabled;
  console.warn(
    `[whome config] MODULES_ENABLED missing known modules (${missing.join(", ")}); including them in development catalog`,
  );
  return [...new Set([...modulesEnabled, ...KNOWN_HOUSEHOLD_MODULES])];
}

let cached: Env | null = null;

/** Clears cached env (tests only). */
export function resetEnvCache(): void {
  cached = null;
  resetRootDotenvFlag();
}

export function loadEnv(raw?: NodeJS.ProcessEnv): Env {
  if (cached) return cached;
  if (raw === undefined) {
    loadRootDotenv();
  }
  const source = raw ?? process.env;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${msg}`);
  }
  cached = {
    ...parsed.data,
    ALLOW_PUBLIC_SIGNUP:
      parsed.data.ALLOW_PUBLIC_SIGNUP ?? parsed.data.NODE_ENV !== "production",
    MODULES_ENABLED: ensureDevModuleCatalog(parsed.data.NODE_ENV, parsed.data.MODULES_ENABLED),
  };

  if (cached.NODE_ENV === "development") {
    const devWarnings = validateDevPublicAppUrl({
      nodeEnv: cached.NODE_ENV,
      publicAppUrl: cached.PUBLIC_APP_URL,
      devProfile: cached.WHOME_DEV_PROFILE,
      googleOAuthRedirectUri: cached.GOOGLE_OAUTH_REDIRECT_URI,
    });
    for (const msg of devWarnings) {
      console.warn(`[whome config] ${msg}`);
    }
    const profile = cached.WHOME_DEV_PROFILE ?? inferDevWebProfile(cached.PUBLIC_APP_URL);
    const redirects = oauthRedirectUris(cached.PUBLIC_APP_URL);
    console.log(
      `[whome config] dev web profile=${profile ?? "custom"} · PUBLIC_APP_URL=${cached.PUBLIC_APP_URL} · OAuth redirects: ${redirects.login} | ${redirects.calendar}`,
    );
  }

  return cached;
}

export function parseHouseholdModulesJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((m): m is string => typeof m === "string" && m.length > 0);
    }
  } catch {
    /* */
  }
  return ["core"];
}

export function isModuleEnabled(env: Env, module: string): boolean {
  return env.MODULES_ENABLED.includes(module);
}

/** Env cap intersected with household `modules_enabled` JSON. Core is always on. */
export function isModuleEnabledForHousehold(
  env: Env,
  householdModules: string[],
  module: string,
): boolean {
  if (module === "core") return true;
  if (!isModuleEnabled(env, module)) return false;
  return householdModules.includes(module);
}

export {
  IMPORTED_STUB_EMAIL_DOMAIN,
  importedStubEmail,
  isImportedStubEmail,
  slugLegacyName,
} from "./imported-stub.js";
export { parseHouseholdMemberEmailMap } from "./household-member-map.js";
export {
  collectLegacyNameCandidates,
  legacyDisplayNameMatches,
} from "./legacy-name-match.js";

export function isSmtpConfigured(env: Env): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}
