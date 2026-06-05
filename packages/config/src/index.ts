import { z } from "zod";
import { validateDevPublicAppUrl, oauthRedirectUris, inferDevWebProfile } from "./dev-url.js";
import { loadRootDotenv, resetRootDotenvFlag } from "./load-dotenv.js";

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
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
    GOOGLE_CALENDAR_DEFAULT_SYNC_MODE: syncMode.default("import_only"),
    MODULES_ENABLED: z
      .string()
      .default("core,school,calendar_sync")
      .transform((s) =>
        s
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
      ),
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
  cached = parsed.data;

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

export function isModuleEnabled(env: Env, module: string): boolean {
  return env.MODULES_ENABLED.includes(module);
}

export {
  IMPORTED_STUB_EMAIL_DOMAIN,
  importedStubEmail,
  isImportedStubEmail,
  slugLegacyName,
} from "./imported-stub.js";
export { parseHouseholdMemberEmailMap } from "./household-member-map.js";

export function isSmtpConfigured(env: Env): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}
