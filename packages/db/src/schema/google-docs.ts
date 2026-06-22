import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { households, users } from "./household.js";

export const googleDocsConnections = pgTable(
  "google_docs_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    accessTokenEnc: text("access_token_enc"),
    tokenExpiry: timestamp("token_expiry", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("google_docs_connections_user_household").on(t.userId, t.householdId)],
);
