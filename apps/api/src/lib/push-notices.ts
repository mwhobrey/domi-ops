import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdMembers, pushSubscriptions, users } from "@domi-ops/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { deliverUserNotification, isValidTimeZone } from "@domi-ops/calendar-sync";

export type PushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** IANA timezone of the registering device (WHO-233). */
  timezone?: string | null;
};

export function isWebPushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
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

  const body = `${input.posterDisplayName}: ${truncateBody(input.content)}`;
  await deliverUserNotification(db, env, {
    userIds: enabledIds,
    householdId: input.householdId,
    title: "New household notice",
    body,
    url: "/dashboard?notices=1",
    tag: `notice-${input.noticeId}`,
  });
}

export async function upsertPushSubscription(
  db: Database,
  userId: string,
  sub: PushSubscriptionPayload,
): Promise<void> {
  const rawTz =
    typeof sub.timezone === "string" && sub.timezone.trim() ? sub.timezone.trim().slice(0, 64) : null;
  const timezone = rawTz && isValidTimeZone(rawTz) ? rawTz : null;
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
        ...(timezone ? { timezone } : {}),
      })
      .where(eq(pushSubscriptions.id, existing[0].id));
    return;
  }

  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    authKey: sub.keys.auth,
    timezone,
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
