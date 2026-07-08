import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { pushSubscriptions, userNotifications } from "@domi-ops/db";
import { inArray } from "drizzle-orm";
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
