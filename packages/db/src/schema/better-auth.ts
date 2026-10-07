import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./household.js";

/** Better Auth sessions (replaces legacy auth_sessions). */
export const baSessions = pgTable(
  "ba_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ba_sessions_user_id_idx").on(t.userId)],
);

/** Better Auth accounts — email/password hashes and social login links. */
export const baAccounts = pgTable(
  "ba_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: varchar("provider_id", { length: 32 }).notNull(),
    // Legacy: Better Auth 1.7.0-1.7.2 matched accounts on this column (migration 0064). 1.7.3+
    // went back to (providerId, accountId) and ignores it. Nullable, no index, so no cleanup is
    // needed; nothing writes it any more.
    issuer: text("issuer"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ba_accounts_user_id_idx").on(t.userId),
    // Better Auth 1.7.3+ treats two rows for one provider account as fatal; keep it impossible (WHO-449, migration 0093).
    uniqueIndex("ba_accounts_provider_account_uidx").on(t.providerId, t.accountId),
  ],
);

/** Better Auth email verification / password reset tokens. */
export const baVerifications = pgTable("ba_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
