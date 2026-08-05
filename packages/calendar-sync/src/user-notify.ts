import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { pushSubscriptions, userNotifications } from "@domi-ops/db";
import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { deliverWebPush, type WebPushPayload } from "./push-delivery.js";

function configured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/** Persist in-app notification rows (always, even when push is unavailable). */
export async function persistUserNotifications(
  db: Database,
  input: {
    userIds: string[];
    householdId: string;
    title: string;
    body: string;
    url: string;
    tag?: string;
  },
): Promise<void> {
  const uniqueIds = [...new Set(input.userIds)];
  if (uniqueIds.length === 0) return;
  await db.insert(userNotifications).values(
    uniqueIds.map((userId) => ({
      userId,
      householdId: input.householdId,
      title: input.title,
      body: input.body,
      url: input.url,
      tag: input.tag ?? null,
    })),
  );
}

/** Persist inbox row once per user+tag (avoids duplicates across per-device pushes). */
export async function persistUserNotificationOnce(
  db: Database,
  input: {
    userId: string;
    householdId: string;
    title: string;
    body: string;
    url: string;
    tag: string;
  },
): Promise<boolean> {
  const [existing] = await db
    .select({ id: userNotifications.id })
    .from(userNotifications)
    .where(and(eq(userNotifications.userId, input.userId), eq(userNotifications.tag, input.tag)))
    .limit(1);
  if (existing) return false;
  await db.insert(userNotifications).values({
    userId: input.userId,
    householdId: input.householdId,
    title: input.title,
    body: input.body,
    url: input.url,
    tag: input.tag,
  });
  return true;
}

export type PushSubscriptionDelivery = {
  id: string;
  endpoint: string;
  p256dh: string;
  authKey: string;
};

/** Write inbox history and send Web Push to subscribed devices. */
export async function deliverUserNotification(
  db: Database,
  env: Env,
  input: {
    userIds: string[];
    householdId: string;
    title: string;
    body: string;
    url: string;
    tag: string;
  },
): Promise<void> {
  const uniqueIds = [...new Set(input.userIds)];
  if (uniqueIds.length === 0) return;

  await persistUserNotifications(db, input);

  if (!configured(env)) return;
  webpush.setVapidDetails(
    env.VAPID_SUBJECT!,
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, uniqueIds));

  const payload: WebPushPayload = {
    title: input.title,
    body: input.body,
    tag: input.tag,
    data: { url: input.url },
  };
  await deliverWebPush(db, subs, payload);
}

/**
 * Deliver to specific push endpoints (per-device timing). Inbox is once-per-tag.
 */
export async function deliverUserNotificationToSubscriptions(
  db: Database,
  env: Env,
  input: {
    userId: string;
    householdId: string;
    title: string;
    body: string;
    url: string;
    tag: string;
    subscriptions: PushSubscriptionDelivery[];
  },
): Promise<void> {
  await persistUserNotificationOnce(db, {
    userId: input.userId,
    householdId: input.householdId,
    title: input.title,
    body: input.body,
    url: input.url,
    tag: input.tag,
  });

  if (!configured(env) || input.subscriptions.length === 0) return;
  webpush.setVapidDetails(
    env.VAPID_SUBJECT!,
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );

  const payload: WebPushPayload = {
    title: input.title,
    body: input.body,
    tag: input.tag,
    data: { url: input.url },
  };
  await deliverWebPush(db, input.subscriptions, payload);
}
