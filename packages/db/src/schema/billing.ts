import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { households } from "./household.js";

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
]);

/** Hosted billing + module entitlements — one row per household when on Domi Ops cloud */
export const householdSubscriptions = pgTable(
  "household_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** JSON array of module keys — ceiling for household Settings toggles on hosted */
    modulesEntitled: text("modules_entitled").notNull(),
    stripeCustomerId: varchar("stripe_customer_id", { length: 256 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 256 }),
    status: subscriptionStatusEnum("status").notNull().default("trialing"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("household_subscriptions_household_id").on(t.householdId)],
);

/** Stripe event idempotency — prevents double-processing on webhook retries */
export const stripeEvents = pgTable("stripe_events", {
  id: varchar("id", { length: 256 }).primaryKey(),
  type: varchar("type", { length: 128 }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
