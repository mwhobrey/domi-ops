import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createBetterAuth } from "@whome/auth";
import { loadEnv, isModuleEnabled } from "@whome/config";
import { createDb } from "@whome/db";
import { createAuthMiddleware, type AppVariables } from "./middleware/auth.js";
import { whomeSessionRoutes } from "./routes/auth.js";
import { calendarRoutes } from "./routes/calendar.js";
import { coreRoutes } from "./routes/core.js";
import { googleCalendarAuthRoutes } from "./routes/google-calendar-auth.js";
import { healthRoutes } from "./routes/health.js";
import { schoolRoutes } from "./routes/school.js";
import { schoolUploadRoutes } from "./routes/school-upload.js";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const betterAuth = createBetterAuth(db, env);

const app = new Hono<{ Variables: AppVariables }>();

app.use(
  "*",
  cors({
    origin: env.PUBLIC_APP_URL,
    credentials: true,
  }),
);

app.route("/auth/google/calendar", googleCalendarAuthRoutes(db, env));
app.route("/auth", whomeSessionRoutes(db, betterAuth));

app.on(["POST", "GET"], "/auth/*", (c) => betterAuth.handler(c.req.raw));

app.use("*", createAuthMiddleware(db, env, betterAuth));

app.route("/", healthRoutes(db));
app.route("/api/calendar", calendarRoutes(db, env));
app.route("/api/core", coreRoutes(db, env));
app.route("/api/school", schoolRoutes(db, env));
app.route("/api/school/upload", schoolUploadRoutes(db, env));

app.get("/api/modules", (c) =>
  c.json({
    enabled: env.MODULES_ENABLED,
    calendarSync: isModuleEnabled(env, "calendar_sync"),
    school: isModuleEnabled(env, "school"),
    core: isModuleEnabled(env, "core"),
  }),
);

const port = Number(process.env.PORT ?? 4000);
console.log(`whome api listening on :${port} (${env.DEPLOYMENT_MODE})`);
serve({ fetch: app.fetch, port });
