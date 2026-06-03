import { z } from "zod";

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

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${msg}`);
  }
  cached = parsed.data;
  return parsed.data;
}

export function isModuleEnabled(env: Env, module: string): boolean {
  return env.MODULES_ENABLED.includes(module);
}
