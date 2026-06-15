import type { Database } from "@whome/db";
import { pushSubscriptions } from "@whome/db";
import { eq } from "drizzle-orm";
import webpush from "web-push";

export type WebPushPayload = {
  title: string;
  body: string;
  tag: string;
  data: { url: string; [key: string]: string | undefined };
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  authKey: string;
};

export async function deliverWebPush(
  db: Database,
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
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        }
      }
    }),
  );
}
