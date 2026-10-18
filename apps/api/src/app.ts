import { Hono } from "hono";
import { cors } from "hono/cors";
import { createBetterAuth } from "@domi-ops/auth";
import { isHostedDeployment, isModuleEnabled, type Env } from "@domi-ops/config";
import { createDb, createScopedDb } from "@domi-ops/db";
import { createAuthMiddleware, type AppVariables } from "./middleware/auth.js";
import { createTenantMiddleware } from "./middleware/tenant.js";
import { createSubscriptionMiddleware } from "./middleware/subscription.js";
import { createDemoProtectionMiddleware } from "./middleware/demo.js";
import { householdInvitationRoutes } from "./routes/household-invitations.js";
import { INVITATION_COOKIE, lookupHouseholdInvitation } from "./lib/household-invitations.js";
import { whomeSessionRoutes } from "./routes/auth.js";
import { calendarRoutes } from "./routes/calendar.js";
import { scheduleConflictRoutes } from "./routes/schedule-conflicts.js";
import { goalsRoutes } from "./routes/goals.js";
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
import { healthPharmacyRoutes } from "./routes/health-pharmacies.js";
import { healthSupplyRoutes } from "./routes/health-supply.js";
import { healthRefillRoutes } from "./routes/health-refills.js";
import { healthOrganizerRoutes } from "./routes/health-organizers.js";
import { healthOrganizerAppointmentRoutes } from "./routes/health-organizer-appointments.js";
import { healthOrganizerSessionRoutes } from "./routes/health-organizer-sessions.js";
import { healthCheckRoutes } from "./routes/health-checks.js";
import { healthCheckGroupRoutes } from "./routes/health-check-groups.js";
import { healthMyallyfileRoutes } from "./routes/health-myallyfile.js";
import { healthWithingsRoutes } from "./routes/health-withings.js";
import { integrationsWithingsRoutes } from "./routes/integrations-withings.js";
import { schoolClassesRoutes } from "./routes/school-classes.js";
import { schoolCourseToolsRoutes } from "./routes/school-course-tools.js";
import { schoolRecordsRoutes } from "./routes/school-records.js";
import { schoolAssignmentsRoutes } from "./routes/school-assignments.js";
import { schoolMaterialsRoutes } from "./routes/school-materials.js";
import { schoolUploadRoutes } from "./routes/school-upload.js";
import { browserUploadRoutes } from "./routes/browser-upload.js";
import { driveRoutes } from "./routes/drive.js";
import { drivePublicRoutes } from "./routes/drive-public.js";
import { googleDocsAuthRoutes } from "./routes/google-docs-auth.js";
import { weeklyReportRoutes } from "./routes/weekly-reports.js";
import { reportRoutes } from "./routes/reports.js";
import { billingRoutes } from "./routes/billing.js";
import { nativeAuthRoutes } from "./routes/native-auth.js";
import { revenueCatRoutes } from "./routes/revenuecat.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { glanceConfigRoutes } from "./routes/glance-config.js";
import { dashboardLayoutRoutes } from "./routes/dashboard-layout.js";
import { telemetryRoutes } from "./routes/telemetry.js";
import { setupRoutes } from "./routes/setup.js";
import {
  hasSetupAccess,
  needsGreenfieldSetup,
  SETUP_GRANT_COOKIE,
} from "@domi-ops/auth";
import { getCookie } from "hono/cookie";
import { isInvalidInputError } from "./lib/db-errors.js";

export function createApplication(env: Env, options: { stripeFactory?: Parameters<typeof billingRoutes>[2]; authCookiePrefix?: string } = {}) {
  const baseDb = createDb(env.DATABASE_URL);
  const db = createScopedDb(baseDb);
  // Better Auth and the setup check get a pool of their own. Every authenticated request holds one `baseDb`
  // connection for its whole duration (the tenant transaction), and /auth/session and the /auth/* catch-all
  // ask Better Auth for the session while holding it. If that came from the same pool, ten simultaneous
  // requests would each hold a connection and wait for another: every request, /api/healthz included, hangs
  // and nothing ever frees (whome, 2026-10-14). A request that holds a `baseDb` connection never waits for
  // `baseDb` again this way, because `authDb` is only ever held for a single short query.
  const authDb = createDb(env.DATABASE_URL);
  const betterAuth = createBetterAuth(authDb, env, {
    cookiePrefix: options.authCookiePrefix,
    deferHouseholdMembership: async (headers) => {
      const cookie = headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${INVITATION_COOKIE}=`));
      const token = cookie?.slice(INVITATION_COOKIE.length + 1);
      return Boolean(token && await lookupHouseholdInvitation(authDb, token));
    },
  });

  const app = new Hono<{ Variables: AppVariables }>();

  // WHO-253 — there was no global error handler at all before this; an uncaught throw in any
  // route handler silently became a bare 500 with zero logging anywhere. The console.error below
  // is what reaches Sentry — captureConsoleIntegration (initSentry) auto-reports every
  // console.error call site, so an explicit Sentry.captureException(err) here would double-fire
  // one Sentry issue per failure (CodeRabbit caught the same duplication in the worker's
  // equivalent handler). No-op when SENTRY_DSN is unset either way.
  app.onError((err, c) => {
    // A malformed id from the client (e.g. /events/not-a-uuid) is a 400, not a server fault.
    if (isInvalidInputError(err)) return c.json({ error: "invalid_input" }, 400);
    console.error(`[domi-ops api] unhandled error on ${c.req.method} ${c.req.path}:`, err);
    return c.json({ error: "internal_error" }, 500);
  });

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
  app.use("*", createDemoProtectionMiddleware(env));
  app.use("*", createAuthMiddleware(baseDb, env, betterAuth));
  app.use("*", createTenantMiddleware(db, env));
  app.use("/api/*", createSubscriptionMiddleware(db, env));

  app.route("/auth/google/calendar", googleCalendarAuthRoutes(db, env));
  app.route("/auth/google/docs", googleDocsAuthRoutes(db, env));
  app.route("/auth", whomeSessionRoutes(db, env, betterAuth));

  app.on(["POST", "GET"], "/auth/*", async (c) => {
    const path = new URL(c.req.url).pathname;
    const grantCookie = getCookie(c, SETUP_GRANT_COOKIE);
    const headerToken = c.req.header("x-setup-token");
    const setupAccess = hasSetupAccess(env, { headerToken, grantCookie });
    const needsSetup = await needsGreenfieldSetup(authDb, env);

    if (path.includes("/sign-up")) {
      if (env.DEMO_MODE) {
        return c.json({ message: "Sign-up is disabled on the demo instance" }, 403);
      }
      if (path.endsWith("/sign-up/email")) {
          const token = getCookie(c, INVITATION_COOKIE);
          const invitation = token ? await lookupHouseholdInvitation(authDb, token) : null;
          const body = await c.req.raw.clone().json().catch(() => null) as { email?: string } | null;
          if (invitation && body?.email?.trim().toLowerCase() === invitation.invitation.email) return betterAuth.handler(c.req.raw);
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

  app.route("/api", healthRoutes(db));
  app.route("/api/calendar", calendarRoutes(db, env));
  app.route("/api/schedule-conflicts", scheduleConflictRoutes(db, env));
  app.route("/api/goals", goalsRoutes(db, env));
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
  app.route("/api/core/upload", browserUploadRoutes(db, env));
  app.route("/api/core/drive", driveRoutes(db, env));
  app.route("/api/core/onboarding", onboardingRoutes(db, env));
  app.route("/api/core/glance-config", glanceConfigRoutes(db, env));
  app.route("/api/core/dashboard-layout", dashboardLayoutRoutes(db, env));
  app.route("/s", drivePublicRoutes(db, env));
  app.route("/api/school", schoolClassesRoutes(db, env));
  app.route("/api/school", schoolCourseToolsRoutes(db, env));
  app.route("/api/school", schoolRecordsRoutes(db, env));
  app.route("/api/school", schoolAssignmentsRoutes(db, env));
  app.route("/api/school", schoolMaterialsRoutes(db, env));
  app.route("/api/school/upload", schoolUploadRoutes(db, env));
  app.route("/api/health", householdHealthRoutes(db, env));
  app.route("/api/health/medication-groups", healthMedicationGroupRoutes(db, env));
  app.route("/api/health/pharmacies", healthPharmacyRoutes(db, env));
  app.route("/api/health", healthSupplyRoutes(db, env));
  app.route("/api/health", healthRefillRoutes(db, env));
  app.route("/api/health/organizers", healthOrganizerRoutes(db, env));
  app.route("/api/health/organizers", healthOrganizerAppointmentRoutes(db, env));
  app.route("/api/health/organizers", healthOrganizerSessionRoutes(db, env));
  app.route("/api/health/checks", healthCheckRoutes(db, env));
  app.route("/api/health/check-groups", healthCheckGroupRoutes(db, env));
  app.route("/api/health/myallyfile", healthMyallyfileRoutes(db, env));
  app.route("/api/health/withings", healthWithingsRoutes(db, env));
  app.route("/api/integrations/withings", integrationsWithingsRoutes(db, env));
  app.route("/api/billing", billingRoutes(db, env, options.stripeFactory));
  app.route("/api", householdInvitationRoutes(db, env));
  app.route("/api/billing", revenueCatRoutes(db, env));
  app.route("/api/core", nativeAuthRoutes(db, env, betterAuth));
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

  return app;
}
