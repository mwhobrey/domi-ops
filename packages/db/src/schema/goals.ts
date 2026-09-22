import {
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { households, householdMembers, users } from "./household.js";
import { noteVisibilityEnum } from "./core.js";

/** Where a goal's progress came from. Only "manual" is wired up in WHO-322 — chores/health/school
 *  auto-progress ship in WHO-323/324/325, reusing this same column rather than a migration. */
export const goalProgressSourceTypeEnum = pgEnum("goal_progress_source_type", [
  "manual",
  "chores",
  "health",
  "school",
]);

export const goalRedemptionStatusEnum = pgEnum("goal_redemption_status", [
  "pending",
  "approved",
  "denied",
]);

/** Household reward catalog. Declared before `goals`/`goal_milestones` since a milestone can
 *  optionally link one. Table name is prefixed (not bare "rewards") to match every other
 *  module's convention (health_*, school_*, drive_*) and avoid a collision-prone generic name. */
export const goalRewards = pgTable("goal_rewards", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  /** Retire instead of delete once a reward has redemption history (see goalRewardRedemptions). */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A goal is just its ordered milestones — the last milestone IS the goal's completion, there's
 *  no separate target field. Visibility reuses noteVisibilityEnum; unlike health (WHO-226: no
 *  admin override on private PHI), owner/admin DO get an override here — they need to see and
 *  approve a kid's private goal. */
export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  ownerMemberId: uuid("owner_member_id")
    .notNull()
    .references(() => householdMembers.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  visibility: noteVisibilityEnum("visibility").notNull().default("household"),
  /** Ratchet — set once when the final milestone is achieved, never unset by a later correction. */
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const goalMilestones = pgTable(
  "goal_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    threshold: real("threshold").notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    rewardId: uuid("reward_id").references(() => goalRewards.id, { onDelete: "set null" }),
    /** Ratchet — never unset once set, even if a later negative progress correction drops the
     *  running total back below threshold. Protects an already-claimed/approved reward. */
    achievedAt: timestamp("achieved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("goal_milestones_goal_sort").on(t.goalId, t.sortOrder)],
);

export const goalProgressEvents = pgTable("goal_progress_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  sourceType: goalProgressSourceTypeEnum("source_type").notNull().default("manual"),
  /** Reserved for WHO-324 (health auto-progress) — which health_event_type to count. Plain text,
   *  not an FK/enum into health.ts, so this schema has no import dependency on the health module
   *  and goals keeps working with Health disabled. */
  sourceEventType: text("source_event_type"),
  /** May be negative — corrections/undo, same spirit as deleting a health med dose log. */
  amount: real("amount").notNull(),
  note: text("note"),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

export const goalRewardRedemptions = pgTable(
  "goal_reward_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => goalMilestones.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    // No onDelete — Postgres default NO ACTION backstops the app-level 409 `reward_in_use` guard
    // on DELETE /api/goals/rewards/:id, so redemption history always knows what reward it was for.
    rewardId: uuid("reward_id")
      .notNull()
      .references(() => goalRewards.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
    status: goalRedemptionStatusEnum("status").notNull().default("pending"),
    claimedByUserId: uuid("claimed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
  },
  (t) => [uniqueIndex("goal_reward_redemptions_milestone_unique").on(t.milestoneId)],
);
