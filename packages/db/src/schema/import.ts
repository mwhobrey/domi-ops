import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { households } from "./household.js";

/** Tracks rows imported from HomeHub for idempotent re-runs */
export const importRecords = pgTable("import_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  sourceSystem: varchar("source_system", { length: 32 }).notNull().default("homehub"),
  sourceTable: varchar("source_table", { length: 64 }).notNull(),
  sourceId: varchar("source_id", { length: 64 }).notNull(),
  targetTable: varchar("target_table", { length: 64 }).notNull(),
  targetId: uuid("target_id").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});
