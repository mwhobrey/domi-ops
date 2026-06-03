import { Hono } from "hono";
import { encryptSensitive } from "@whome/crypto";
import type { Env } from "@whome/config";
import { isModuleEnabled } from "@whome/config";
import {
  exchangeGoogleCode,
  googleAuthUrl,
  googleOAuthRedirectUri,
  GOOGLE_CALENDAR_SCOPES,
  randomOAuthState,
} from "@whome/auth";
import type { Database } from "@whome/db";
import {
  calendarConnections,
  calendars,
  linkedGoogleCalendars,
} from "@whome/db";
import { listGoogleCalendars, enqueueSyncJob } from "@whome/calendar-sync";
import { ensureAccessToken } from "@whome/calendar-sync";
import { and, eq } from "drizzle-orm";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { consumeOAuthState, setOAuthState } from "../lib/oauth-state.js";

const CALENDAR_OAUTH_PREFIX = "oauth:calendar";

function redisUrl(env: Env): string {
  return env.REDIS_URL ?? "redis://localhost:6379";
}

export function googleCalendarAuthRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use("*", requireAuth(env));

  app.get("/start", async (c) => {
    if (!isModuleEnabled(env, "calendar_sync")) {
      return c.json({ error: "calendar_sync_disabled" }, 403);
    }
    const auth = c.get("auth");
    if (!auth) return c.json({ error: "unauthorized" }, 401);
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
          const [cal] = await db
            .insert(calendars)
            .values({
              householdId: pending.householdId,
              ownerUserId: pending.userId,
              name: String(item.summary ?? gId).slice(0, 128),
              color: String(item.backgroundColor ?? "#3b82f6").slice(0, 16),
              visibility: "private",
            })
            .returning();

          await db.insert(linkedGoogleCalendars).values({
            connectionId,
            googleCalendarId: gId,
            summary: String(item.summary ?? ""),
            backgroundColor: String(item.backgroundColor ?? ""),
            syncEnabled: true,
            targetCalendarId: cal.id,
          });
        }
      }

      const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
      await enqueueSyncJob(redisUrl, "google.calendar.full_import", {
        connectionId,
        householdId: pending.householdId,
        userId: pending.userId,
      });

      return c.redirect(`${env.PUBLIC_APP_URL}/calendar?connected=1`);
    } catch (e) {
      console.error("calendar oauth callback", e);
      return c.redirect(`${env.PUBLIC_APP_URL}/calendar?error=oauth`);
    }
  });

  return app;
}
