import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { householdMembers, pushSubscriptions, users } from "@whome/db";
import { and, eq, inArray } from "drizzle-orm";
import { configureWebPush, isWebPushConfigured } from "./push-notices.js";
import webpush from "web-push";

export async function notifyHouseholdOfCalendarReminder(
  db: Database,
  env: Env,
  input: {
    householdId: string;
    eventId: string;
    title: string;
    startsInMinutes: number;
  },
): Promise<void> {
  if (!isWebPushConfigured(env)) return;
  configureWebPush(env);

  const members = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, input.householdId));

  const recipientIds = members.map((m) => m.userId);
  if (recipientIds.length === 0) return;

  const enabled = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, recipientIds),
        eq(users.pushCalendarRemindersEnabled, true),
      ),
    );
  const enabledIds = enabled.map((u) => u.id);
  if (enabledIds.length === 0) return;

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, enabledIds));

  const body =
    input.startsInMinutes >= 1440
      ? `${input.title} starts tomorrow`
      : input.startsInMinutes >= 60
        ? `${input.title} starts in ${Math.round(input.startsInMinutes / 60)} hour(s)`
        : `${input.title} starts in ${input.startsInMinutes} minutes`;

  const payload = JSON.stringify({
    title: "Calendar reminder",
    body,
    url: `/calendar?event=${input.eventId}`,
  });

  await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.authKey },
        },
        payload,
      ),
    ),
  );
}
