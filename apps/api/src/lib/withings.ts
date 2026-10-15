import type { Env } from "@domi-ops/config";
import { healthMedPushActionSecret, mintWithingsWebhookToken } from "@domi-ops/crypto";
import type { healthWithingsLinks } from "@domi-ops/db";
import { WITHINGS_MAX_BACKFILL_DAYS, WITHINGS_DEFAULT_BACKFILL_DAYS, withingsScopeAllowsWorkouts } from "@domi-ops/calendar-sync";

export const WITHINGS_OAUTH_PREFIX = "oauth:withings";

/**
 * How long the connect step's saved state lives. Generous on purpose: someone with a new Withings account has to
 * sign up or sign in, possibly subscribe to Withings+ (needed for accounts created after October 12, 2026), and
 * sign in again, which easily outruns the 10 minute default. It stays single use and tied to the signed-in user,
 * so a longer window does not weaken the check.
 */
export const WITHINGS_OAUTH_STATE_TTL_SEC = 30 * 60;

/** What the connect step parks in Redis while the user is at Withings. Single use, 30 minute TTL. */
export type WithingsOAuthState = {
  userId: string;
  householdId: string;
  memberId: string;
  backfillDays: number;
};

/** The redirect URI registered with the Withings app: this deployment's public URL plus a fixed path. */
export function withingsRedirectUri(env: Pick<Env, "PUBLIC_APP_URL">): string {
  return new URL("/api/integrations/withings/callback", env.PUBLIC_APP_URL).toString();
}

/**
 * The URL Withings is told to call. Withings does not sign notifications, so the signed token in the
 * query is what authenticates the call (see `mintWithingsWebhookToken`).
 */
export function withingsWebhookUrl(
  env: Pick<Env, "PUBLIC_APP_URL" | "ENCRYPTION_KEY" | "SESSION_SECRET">,
  link: { id: string; householdId: string },
): string | null {
  const secret = healthMedPushActionSecret(env);
  if (!secret) return null;
  const url = new URL("/api/integrations/withings/webhook", env.PUBLIC_APP_URL);
  url.searchParams.set("t", mintWithingsWebhookToken({ householdId: link.householdId, linkId: link.id }, secret));
  return url.toString();
}

/** A whole number of days, within what a backfill may ask for. */
export function normalizeBackfillDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(n)) return WITHINGS_DEFAULT_BACKFILL_DAYS;
  return Math.min(Math.max(Math.floor(n), 1), WITHINGS_MAX_BACKFILL_DAYS);
}

type LinkRow = typeof healthWithingsLinks.$inferSelect;

/** Never includes a token, and not the Withings user id either. */
export function serializeWithingsLink(row: LinkRow) {
  return {
    memberId: row.memberId,
    status: row.status,
    linkedAt: row.linkedAt.toISOString(),
    backfillFrom: row.backfillFrom.toISOString(),
    backfillDone: row.backfillDoneAt != null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    syncPending: row.syncRequestedAt != null,
    /** Whether the person approved activity access, which workouts need. Links made before it existed have not. */
    workouts: withingsScopeAllowsWorkouts(row.scope),
  };
}
