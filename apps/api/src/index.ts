import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createBetterAuth } from "@domi-ops/auth";
import { loadEnv, isHostedDeployment, isModuleEnabled } from "@domi-ops/config";
import { createDb, createScopedDb } from "@domi-ops/db";
import { createAuthMiddleware, type AppVariables } from "./middleware/auth.js";
import { createTenantMiddleware } from "./middleware/tenant.js";
import { whomeSessionRoutes } from "./routes/auth.js";
import { calendarRoutes } from "./routes/calendar.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { weatherRoutes } from "./routes/weather.js";
import { noticesRoutes } from "./routes/notices.js";
import { pushRoutes } from "./routes/push.js";
import { shoppingRoutes } from "./routes/shopping.js";
import { choresRoutes } from "./routes/chores.js";
import { notesRoutes } from "./routes/notes.js";
import { expensesRoutes } from "./routes/expenses.js";
import { profileRoutes } from "./routes/profile.js";
import { householdRoutes } from "./routes/household.js";
import { googleCalendarAuthRoutes } from "./routes/google-calendar-auth.js";
import { healthRoutes } from "./routes/health.js";
import { householdHealthRoutes } from "./routes/household-health.js";
import { healthMedicationGroupRoutes } from "./routes/health-medication-groups.js";
import { schoolRoutes } from "./routes/school.js";
import { schoolUploadRoutes } from "./routes/school-upload.js";
import { browserUploadRoutes } from "./routes/browser-upload.js";
import { driveRoutes } from "./routes/drive.js";
import { drivePublicRoutes } from "./routes/drive-public.js";
import { googleDocsAuthRoutes } from "./routes/google-docs-auth.js";
import { weeklyReportRoutes } from "./routes/weekly-reports.js";
import { reportRoutes } from "./routes/reports.js";
import { billingRoutes } from "./routes/billing.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { glanceConfigRoutes } from "./routes/glance-config.js";
import { telemetryRoutes } from "./routes/telemetry.js";
import { setupRoutes } from "./routes/setup.js";
import { ensureS3ReadyOnce } from "./lib/s3.js";
import {
  hasSetupAccess,
  needsGreenfieldSetup,
  SETUP_GRANT_COOKIE,
} from "@domi-ops/auth";
import { getCookie } from "hono/cookie";

const env = loadEnv();
const baseDb = createDb(env.DATABASE_URL);
const db = createScopedDb(baseDb);
const betterAuth = createBetterAuth(baseDb, env);

const app = new Hono<{ Variables: AppVariables }>();

// Telemetry is the one endpoint meant to be called cross-origin from arbitrary self-host
// domains (opt-in metrics phoning home to the central collector) — no cookies/credentials
// involved, so a wide-open origin here doesn't touch the auth-cookie CORS lockdown below.
// MUST be registered before the global cors() call: Hono's cors middleware answers
// OPTIONS preflight requests itself without calling next(), so a later, more specific
// cors() can never override an earlier general one for preflight — order is the fix,
// not specificity (confirmed by hand: a self-host-origin preflight got the locked-down
// PUBLIC_APP_URL response, silently, until this was reordered).
app.use("/api/telemetry/*", cors({ origin: "*" }));

app.use(
  "*",
  cors({
    origin: env.PUBLIC_APP_URL,
    credentials: true,
  }),
);

// Session → auth context must run before calendar OAuth (reads c.get("auth") on /start).
app.use("*", createAuthMiddleware(baseDb, env, betterAuth));
app.use("*", createTenantMiddleware(db, env));

app.route("/auth/google/calendar", googleCalendarAuthRoutes(db, env));
app.route("/auth/google/docs", googleDocsAuthRoutes(db, env));
app.route("/auth", whomeSessionRoutes(db, env, betterAuth));

app.on(["POST", "GET"], "/auth/*", async (c) => {
  const path = new URL(c.req.url).pathname;
  const grantCookie = getCookie(c, SETUP_GRANT_COOKIE);
  const headerToken = c.req.header("x-setup-token");
  const setupAccess = hasSetupAccess(env, { headerToken, grantCookie });
  const needsSetup = await needsGreenfieldSetup(baseDb, env);

  if (path.includes("/sign-up")) {
    if (env.DEMO_MODE) {
      return c.json({ message: "Sign-up is disabled on the demo instance" }, 403);
    }
    if (isHostedDeployment(env)) {
      return c.json({ message: "Public sign-up is disabled on hosted deployments" }, 403);
    }
    if (env.ALLOW_PUBLIC_SIGNUP) {
      return betterAuth.handler(c.req.raw);
    }
    if (needsSetup && setupAccess) {
      return betterAuth.handler(c.req.raw);
    }
    const message = needsSetup
      ? "Initial setup requires a valid setup token. Open /setup on this server."
      : "Public sign-up is disabled on this instance";
    return c.json({ message }, 403);
  }

  if (
    needsSetup &&
    !env.ALLOW_PUBLIC_SIGNUP &&
    !env.DEMO_MODE &&
    (path.includes("/callback/google") || path.includes("/sign-in/social"))
  ) {
    if (!setupAccess) {
      // Browser OAuth callback: send the user to /setup.
      // Client fetch for /sign-in/social: return JSON so the login UI can show an error
      // (a 302 is followed by fetch and looks like "nothing happened").
      if (path.includes("/sign-in/social")) {
        return c.json(
          {
            message:
              "Initial setup requires a valid setup token. Open /setup on this server.",
          },
          403,
        );
      }
      const setupUrl = new URL("/setup", env.PUBLIC_APP_URL);
      setupUrl.searchParams.set("error", "token");
      return c.redirect(setupUrl.toString());
    }
  }

  return betterAuth.handler(c.req.raw);
});

app.route("/", healthRoutes(db));
app.route("/api/calendar", calendarRoutes(db, env));
// Setup must mount before the routes below — they all apply requireAuth to every /api/core/*.
app.route("/api/core/setup", setupRoutes(db, env));
app.route("/api/core", dashboardRoutes(db, env));
app.route("/api/core", weatherRoutes(db, env));
app.route("/api/core", noticesRoutes(db, env));
app.route("/api/core", pushRoutes(db, env));
app.route("/api/core", shoppingRoutes(db, env));
app.route("/api/core", choresRoutes(db, env));
app.route("/api/core", notesRoutes(db, env));
app.route("/api/core", expensesRoutes(db, env));
app.route("/api/core", profileRoutes(db, env));
app.route("/api/core", householdRoutes(db, env));
app.route("/api/core", weeklyReportRoutes(db, env));
app.route("/api/core", reportRoutes(db, env));
app.route("/api/core/upload", browserUploadRoutes(env));
app.route("/api/core/drive", driveRoutes(db, env));
app.route("/api/core/onboarding", onboardingRoutes(db, env));
app.route("/api/core/glance-config", glanceConfigRoutes(db, env));
app.route("/s", drivePublicRoutes(db, env));
app.route("/api/school", schoolRoutes(db, env));
app.route("/api/school/upload", schoolUploadRoutes(db, env));
app.route("/api/health", householdHealthRoutes(db, env));
app.route("/api/health/medication-groups", healthMedicationGroupRoutes(db, env));
app.route("/api/billing", billingRoutes(db, env));
app.route("/api/telemetry", telemetryRoutes(db));

app.get("/api/modules", (c) =>
  c.json({
    enabled: env.MODULES_ENABLED,
    calendarSync: isModuleEnabled(env, "calendar_sync"),
    school: isModuleEnabled(env, "school"),
    drive: isModuleEnabled(env, "drive"),
    health: isModuleEnabled(env, "health"),
    core: isModuleEnabled(env, "core"),
  }),
);

const port = Number(process.env.PORT ?? 4000);
if (env.S3_ENDPOINT) {
  void ensureS3ReadyOnce(env).catch((err) => {
    console.warn("[domi-ops s3] bucket/CORS setup failed:", err instanceof Error ? err.message : err);
  });
}
console.log(`domi-ops api listening on :${port} (${env.DEPLOYMENT_MODE})`);
serve({ fetch: app.fetch, port });
