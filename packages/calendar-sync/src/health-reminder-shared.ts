import type { Env } from "@domi-ops/config";
import { decryptSensitive } from "@domi-ops/crypto";
import type { Database } from "@domi-ops/db";
import { pushSubscriptions } from "@domi-ops/db";
import { eq } from "drizzle-orm";
import { resolveAlertTimeZone } from "./alert-timezone.js";
import type { HealthMedReminderRecipient } from "./health-med-reminder-recipients.js";
import { localDateOfInstant } from "./household-time.js";

/**
 * Pieces the medication reminder scan and the health check reminder scan have in common: when a
 * scan looks, who a notification goes to on which device and in which time zone, and how times
 * and names are shown. Moved out of the medication scan (WHO-386) so the two cannot drift.
 */

/** A scan runs every 5 minutes, so it looks this far ahead ... */
export const WINDOW_MS = 6 * 60 * 1000;
/** ... and this far back, so a reminder is still sent if the scan was a little late. */
export const LOOKBACK_MS = 30 * 60 * 1000;

export function householdHasHealthModule(modulesEnabled: string): boolean {
  try {
    return (JSON.parse(modulesEnabled) as string[]).includes("health");
  } catch {
    return false;
  }
}

/**
 * Stored health names are encrypted. Without a key (or with plain text) the value is returned as
 * is; if it can't be decrypted the `fallback` is shown rather than failing the whole scan.
 */
export function decryptReminderName(value: string, env: Env, fallback: string): string {
  if (!env.ENCRYPTION_KEY || !value.startsWith("enc:v1:")) return value;
  try {
    return decryptSensitive(value, env.ENCRYPTION_KEY);
  } catch {
    return fallback;
  }
}

export function parseReminderOffsets(raw: string | null | undefined): number[] {
  if (!raw) return [0];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.filter((n): n is number => typeof n === "number" && n >= 0);
  } catch {
    // ignore
  }
  return [0];
}

/** "2:49 PM" today, "Sep 24, 2:49 PM" another day, with the year only when it differs. */
export function reminderWhenLabel(scheduledAt: Date, timeZone: string, now: Date = new Date()): string {
  try {
    const day = localDateOfInstant(scheduledAt, timeZone);
    const today = localDateOfInstant(now, timeZone);
    return scheduledAt.toLocaleString("en-US", {
      timeZone,
      ...(day === today
        ? {}
        : {
            month: "short" as const,
            day: "numeric" as const,
            ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" as const }),
          }),
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return `${scheduledAt.toISOString().slice(0, 10)} ${scheduledAt.toISOString().slice(11, 16)}`;
  }
}

export type DeliveryTarget = {
  subscriptionId: string | null;
  userId: string;
  timezone: string;
  push?: {
    id: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    authKey: string;
    platform?: string | null;
    deviceToken?: string | null;
  };
};

/**
 * One target per push subscription (each device, in its own time zone, falling back to the
 * household's), or a single inbox-only target when the person has no device registered.
 */
export async function targetsForRecipient(
  db: Database,
  recipient: HealthMedReminderRecipient,
  householdTz: string,
): Promise<DeliveryTarget[]> {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, recipient.userId));

  if (subs.length > 0) {
    return subs.map((sub) => ({
      subscriptionId: sub.id,
      userId: recipient.userId,
      timezone: resolveAlertTimeZone({
        deviceTimezone: sub.timezone,
        householdTimezone: householdTz,
      }),
      push: {
        id: sub.id,
        userId: recipient.userId,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        authKey: sub.authKey,
        platform: sub.platform,
        deviceToken: sub.deviceToken,
      },
    }));
  }

  return [
    {
      subscriptionId: null,
      userId: recipient.userId,
      timezone: resolveAlertTimeZone({ householdTimezone: householdTz }),
    },
  ];
}
