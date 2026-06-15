import {
  bigint,
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

export const temperatureUnitEnum = pgEnum("temperature_unit", ["fahrenheit", "celsius"]);

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
  /** NULL = unlimited (self-host default); hosted tiers set explicitly in Phase 2 */
  storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" }),
  storageUsedBytes: bigint("storage_used_bytes", { mode: "number" }).notNull().default(0),
  /** Per-role Drive access: member/child/guest → none|read|write (owner/admin always write) */
  drivePermissionsJson: text("drive_permissions_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Set for email/Google accounts; null for household-provisioned username members */
  email: varchar("email", { length: 320 }),
  /** Better Auth username plugin — normalized login handle */
  username: varchar("username", { length: 64 }),
  /** Optional display form of username (casing preserved) */
  displayUsername: varchar("display_username", { length: 64 }),
  emailVerified: boolean("email_verified").notNull().default(false),
  displayName: varchar("display_name", { length: 128 }),
  imageUrl: text("image_url"),
  temperatureUnit: temperatureUnitEnum("temperature_unit").notNull().default("fahrenheit"),
  /** When false, household notice Web Push is not sent to this user */
  pushNoticesEnabled: boolean("push_notices_enabled").notNull().default(true),
  /** When false, upcoming calendar event reminder push is not sent to this user */
  pushCalendarRemindersEnabled: boolean("push_calendar_reminders_enabled")
    .notNull()
    .default(true),
  /** When false, chore due/overdue reminder push is not sent to this user */
  pushChoresRemindersEnabled: boolean("push_chores_reminders_enabled")
    .notNull()
    .default(true),
  /** When false, expense budget threshold push is not sent to this user */
  pushExpenseBudgetAlertsEnabled: boolean("push_expense_budget_alerts_enabled")
    .notNull()
    .default(true),
  /** When false, school assignment due/overdue reminder push is not sent to this user */
  pushSchoolRemindersEnabled: boolean("push_school_reminders_enabled")
    .notNull()
    .default(true),
  /** HomeHub import: real login email that should claim this stub user */
  importClaimEmail: varchar("import_claim_email", { length: 320 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email), uniqueIndex("users_username_unique").on(t.username)],
);

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
    /** Household display name — user-editable in profile */
    name: varchar("name", { length: 128 }),
    /** Deprecated: HomeHub status-board label only */
    legacyDisplayName: varchar("legacy_display_name", { length: 64 }),
    legacyExternalId: varchar("legacy_external_id", { length: 128 }),
    /** S3 object key under household-scoped `avatars/` prefix */
    avatarKey: varchar("avatar_key", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("household_members_household_user").on(t.householdId, t.userId)],
);
