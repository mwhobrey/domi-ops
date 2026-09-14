import { pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./household.js";

/** web = VAPID; ios/android = store shell device token (WHO-289). */
export type PushPlatform = "web" | "ios" | "android";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** web | ios | android — default web for existing VAPID rows. */
    platform: varchar("platform", { length: 16 }).notNull().default("web"),
    /**
     * Web Push endpoint, or synthetic `native:{platform}:{token}` for store builds
     * so the existing unique endpoint index still applies.
     */
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    authKey: text("auth_key").notNull(),
    /** APNs / FCM device token when platform is ios/android. */
    deviceToken: text("device_token"),
    /** IANA timezone of the device that registered this subscription (WHO-233). */
    timezone: varchar("timezone", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint),
    uniqueIndex("push_subscriptions_device_token_idx").on(t.deviceToken),
  ],
);
