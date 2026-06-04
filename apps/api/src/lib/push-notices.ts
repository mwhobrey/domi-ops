import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { householdMembers, pushSubscriptions, users } from "@whome/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import webpush from "web-push";

export type PushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function isWebPushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

export function configureWebPush(env: Env): void {
  if (!isWebPushConfigured(env)) return;
  webpush.setVapidDetails(
    env.VAPID_SUBJECT!,
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );
}

function truncateBody(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

export async function notifyHouseholdOfNotice(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    posterUserId: string;
    noticeId: string;
    content: string;
    posterDisplayName: string;
  },
): Promise<void> {
  if (!isWebPushConfigured(env)) return;
  configureWebPush(env);

  const members = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, input.householdId));

  const recipientIds = members.map((m) => m.userId).filter((id) => id !== input.posterUserId);
  if (recipientIds.length === 0) return;

  const enabled = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, recipientIds),
        eq(users.pushNoticesEnabled, true),
      ),
    );
  const enabledIds = enabled.map((u) => u.id);
  if (enabledIds.length === 0) return;

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, enabledIds));

  if (subs.length === 0) return;

  const payload = JSON.stringify({
    title: "New household notice",
    body: `${input.posterDisplayName}: ${truncateBody(input.content)}`,
    tag: `notice-${input.noticeId}`,
    data: {
      url: "/dashboard?notices=1",
      noticeId: input.noticeId,
    },
  });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.authKey },
          },
          payload,
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        }
      }
    }),
  );
}

export async function upsertPushSubscription(
  db: Database,
  userId: string,
  sub: PushSubscriptionPayload,
): Promise<void> {
  const existing = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, sub.endpoint))
    .limit(1);

  if (existing[0]) {
    await db
      .update(pushSubscriptions)
      .set({
        userId,
        p256dh: sub.keys.p256dh,
        authKey: sub.keys.auth,
      })
      .where(eq(pushSubscriptions.id, existing[0].id));
    return;
  }

  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    authKey: sub.keys.auth,
  });
}

export async function deletePushSubscriptionForUser(
  db: Database,
  userId: string,
  endpoint?: string,
): Promise<void> {
  if (endpoint) {
    await db
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)),
      );
    return;
  }
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}

/** Remove subscriptions owned by other users on the same browser endpoint (device handoff). */
export async function claimEndpointForUser(
  db: Database,
  userId: string,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), ne(pushSubscriptions.userId, userId)));
}
