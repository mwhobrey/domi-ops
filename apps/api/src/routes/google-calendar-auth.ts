import { Hono } from "hono";
import { encryptSensitive } from "@domi-ops/crypto";
import type { Env } from "@domi-ops/config";
import { isModuleEnabled } from "@domi-ops/config";
import { isHouseholdModuleEnabled } from "../lib/household-modules.js";
import {
  exchangeGoogleCode,
  googleAuthUrl,
  googleOAuthRedirectUri,
  GOOGLE_CALENDAR_SCOPES,
  randomOAuthState,
} from "@domi-ops/auth";
import type { Database } from "@domi-ops/db";
import { calendarConnections, linkedGoogleCalendars } from "@domi-ops/db";
import { listGoogleCalendars } from "@domi-ops/calendar-sync";
import { ensureAccessToken } from "@domi-ops/calendar-sync";
import { and, eq } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { consumeOAuthState, setOAuthState } from "../lib/oauth-state.js";

const CALENDAR_OAUTH_PREFIX = "oauth:calendar";

function redisUrl(env: Env): string {
  return env.REDIS_URL ?? "redis://localhost:6379";
}

export function googleCalendarAuthRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get("/start", async (c) => {
    const auth = c.get("auth");
    if (!auth) {
      const next = encodeURIComponent("/auth/google/calendar/start");
      return c.redirect(`${env.PUBLIC_APP_URL}/login?next=${next}`);
    }
    if (!(await isHouseholdModuleEnabled(db, env, auth.householdId, "calendar_sync"))) {
      return c.json({ error: "calendar_sync_disabled" }, 403);
    }
    if (!env.GOOGLE_OAUTH_CLIENT_ID) {
      return c.json({ error: "google_oauth_not_configured" }, 503);
    }

    const state = randomOAuthState();
    await setOAuthState(redisUrl(env), CALENDAR_OAUTH_PREFIX, state, {
      userId: auth.userId,
      householdId: auth.householdId,
    });

    const redirectUri =
      env.GOOGLE_OAUTH_REDIRECT_URI ??
      googleOAuthRedirectUri(env, "/auth/google/calendar/callback");
    const url = googleAuthUrl(env, {
      redirectUri,
      scopes: GOOGLE_CALENDAR_SCOPES,
      state,
      accessType: "offline",
      prompt: "consent",
    });
    return c.redirect(url);
  });

  app.get("/callback", async (c) => {
    if (!isModuleEnabled(env, "calendar_sync")) {
      return c.json({ error: "calendar_sync_disabled" }, 403);
    }
    const encKey = env.ENCRYPTION_KEY;
    if (!encKey) return c.json({ error: "encryption_key_required" }, 503);

    const code = c.req.query("code");
    const state = c.req.query("state");
    const pending = state
      ? await consumeOAuthState<{ userId: string; householdId: string }>(
          redisUrl(env),
          CALENDAR_OAUTH_PREFIX,
          state,
        )
      : null;
    if (!code || !pending) {
      return c.redirect(`${env.PUBLIC_APP_URL}/calendar?error=oauth`);
    }

    const redirectUri =
      env.GOOGLE_OAUTH_REDIRECT_URI ??
      googleOAuthRedirectUri(env, "/auth/google/calendar/callback");

    try {
      const tokens = await exchangeGoogleCode(env, code, redirectUri);
      if (!tokens.refresh_token) {
        return c.redirect(`${env.PUBLIC_APP_URL}/calendar?error=no_refresh`);
      }

      const refreshEnc = encryptSensitive(tokens.refresh_token, encKey);
      const accessEnc = tokens.access_token
        ? encryptSensitive(tokens.access_token, encKey)
        : null;
      const tokenExpiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);

      const [existing] = await db
        .select()
        .from(calendarConnections)
        .where(
          and(
            eq(calendarConnections.userId, pending.userId),
            eq(calendarConnections.householdId, pending.householdId),
          ),
        )
        .limit(1);

      let connectionId: string;
      if (existing) {
        await db
          .update(calendarConnections)
          .set({
            refreshTokenEnc: refreshEnc,
            accessTokenEnc: accessEnc,
            tokenExpiry,
            syncMode: env.GOOGLE_CALENDAR_DEFAULT_SYNC_MODE,
          })
          .where(eq(calendarConnections.id, existing.id));
        connectionId = existing.id;
      } else {
        const [conn] = await db
          .insert(calendarConnections)
          .values({
            householdId: pending.householdId,
            userId: pending.userId,
            refreshTokenEnc: refreshEnc,
            accessTokenEnc: accessEnc,
            tokenExpiry,
            syncMode: env.GOOGLE_CALENDAR_DEFAULT_SYNC_MODE,
          })
          .returning();
        connectionId = conn.id;
      }

      const [connRow] = await db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, connectionId))
        .limit(1);
      const accessToken = await ensureAccessToken(db, env, connRow);
      const gCalList = await listGoogleCalendars(accessToken);

      for (const item of gCalList) {
        const gId = String(item.id ?? "");
        if (!gId) continue;
        const [linked] = await db
          .select()
          .from(linkedGoogleCalendars)
          .where(
            and(
              eq(linkedGoogleCalendars.connectionId, connectionId),
              eq(linkedGoogleCalendars.googleCalendarId, gId),
            ),
          )
          .limit(1);

        if (!linked) {
          await db.insert(linkedGoogleCalendars).values({
            connectionId,
            googleCalendarId: gId,
            summary: String(item.summary ?? ""),
            backgroundColor: String(item.backgroundColor ?? ""),
            syncEnabled: false,
            targetCalendarId: null,
          });
        } else {
          await db
            .update(linkedGoogleCalendars)
            .set({
              summary: String(item.summary ?? linked.summary ?? ""),
              backgroundColor: String(
                item.backgroundColor ?? linked.backgroundColor ?? "",
              ),
            })
            .where(eq(linkedGoogleCalendars.id, linked.id));
        }
      }

      // User runs import wizard explicitly (HomeHub parity — no auto full_import).
      return c.redirect(`${env.PUBLIC_APP_URL}/calendar?connected=1&import=1`);
    } catch (e) {
      console.error("calendar oauth callback", e);
      return c.redirect(`${env.PUBLIC_APP_URL}/calendar?error=oauth`);
    }
  });

  return app;
}
