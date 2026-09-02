import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { pushSubscriptions, users } from "@domi-ops/db";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { sendPushSubscriptionExpiredEmail } from "@domi-ops/auth";

export type WebPushNotificationAction = {
  action: string;
  title: string;
};

export type WebPushPayload = {
  title: string;
  body: string;
  tag: string;
  /** Chromium/Android notification action buttons (ignored on iOS PWA). */
  actions?: WebPushNotificationAction[];
  data: { url: string; [key: string]: string | undefined };
};

type SubscriptionRow = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  authKey: string;
};

/**
 * A dead subscription (404/410 from the push service — browser update, revoked permission,
 * cleared site data, etc.) was already detected and cleaned up correctly before this change.
 * What was missing: the affected household member was never told. The stale row just silently
 * disappeared, and reminders on that device — medication doses included — would keep failing
 * forever with nothing but a dev-only console.warn (nothing at all in production) until someone
 * happened to notice. Confirmed live: a real subscription had gone stale and needed re-auth with
 * zero warning beforehand.
 */
async function notifySubscriptionExpired(db: Database, env: Env, userId: string): Promise<void> {
  try {
    const [user] = await db
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user?.email) return;
    await sendPushSubscriptionExpiredEmail(env, { to: user.email, name: user.displayName });
  } catch (err) {
    // Best-effort notice — never let a failure here take down the rest of the delivery batch.
    console.error("[domi-ops push] failed to send push-expired notice:", err);
  }
}

export async function deliverWebPush(
  db: Database,
  env: Env,
  subs: SubscriptionRow[],
  payload: WebPushPayload,
): Promise<void> {
  const json = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.authKey } },
          json,
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number; body?: string }).statusCode;
        const body = (err as { body?: string }).body;
        // Was gated to development only — a production delivery failure (a dead subscription
        // included) left zero trace anywhere. Now always logs, and WHO-253's Sentry wiring
        // actually surfaces it.
        console.error("[domi-ops push] delivery failed", { status, body: body?.slice(0, 200) });
        if (status === 404 || status === 410) {
          const deleted = await db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id))
            .returning({ id: pushSubscriptions.id });
          // Only notify on the delete that actually happened — concurrent deliveries to the
          // same dead endpoint (e.g. a calendar reminder and a chore reminder firing in the same
          // scan window) would otherwise each independently 404/410 and each fire their own
          // "your notifications stopped" email for what is, from the user's perspective, one event.
          if (deleted.length > 0) await notifySubscriptionExpired(db, env, sub.userId);
        }
      }
    }),
  );
}
