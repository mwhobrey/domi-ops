import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const memberRoleEnum = pgEnum("member_role", [
  "owner",
  "admin",
  "member",
  "child",
  "guest",
]);

export const memberPublicLabelEnum = pgEnum("member_public_label", ["name", "nickname"]);

export const deploymentTierEnum = pgEnum("deployment_tier", [
  "self_host",
  "hosted_starter",
  "hosted_dedicated",
]);

/** Root tenant — one per self-hosted instance or one per hosted customer */
export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 64 }),
  tier: deploymentTierEnum("tier").notNull().default("self_host"),
  /** Neon project id or connection ref when tier = hosted_dedicated */
  dedicatedDbRef: varchar("dedicated_db_ref", { length: 256 }),
  timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
  modulesEnabled: text("modules_enabled").notNull().default('["core","school","calendar_sync"]'),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  displayName: varchar("display_name", { length: 128 }),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const householdMembers = pgTable(
  "household_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("member"),
    /** Primary name; user-editable in profile */
    name: varchar("name", { length: 128 }),
    nickname: varchar("nickname", { length: 64 }),
    /** Which field appears on who's home, school roster, etc. */
    publicLabel: memberPublicLabelEnum("public_label").notNull().default("name"),
    /** Deprecated: HomeHub status-board label only */
    legacyDisplayName: varchar("legacy_display_name", { length: 64 }),
    legacyExternalId: varchar("legacy_external_id", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("household_members_household_user").on(t.householdId, t.userId)],
);
