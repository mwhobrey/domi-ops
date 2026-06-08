import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { households, householdMembers, users } from "./household.js";
import { noteVisibilityEnum } from "./core.js";

export const driveObjectKindEnum = pgEnum("drive_object_kind", ["file", "link"]);

export const driveFolders = pgTable("drive_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => driveFolders.id, {
    onDelete: "cascade",
  }),
  name: varchar("name", { length: 256 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const driveObjects = pgTable("drive_objects", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  folderId: uuid("folder_id").references(() => driveFolders.id, { onDelete: "set null" }),
  kind: driveObjectKindEnum("kind").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  description: text("description"),
  url: text("url"),
  s3Key: text("s3_key"),
  contentType: varchar("content_type", { length: 128 }),
  byteSize: integer("byte_size"),
  pinned: boolean("pinned").notNull().default(false),
  tagsJson: text("tags_json").default("[]"),
  visibility: noteVisibilityEnum("visibility").notNull().default("household"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByDisplayName: varchar("created_by_display_name", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const driveShares = pgTable(
  "drive_shares",
  {
    driveObjectId: uuid("drive_object_id")
      .notNull()
      .references(() => driveObjects.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.driveObjectId, t.memberId] })],
);

export const driveReferences = pgTable(
  "drive_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driveObjectId: uuid("drive_object_id")
      .notNull()
      .references(() => driveObjects.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("drive_references_object_entity").on(t.driveObjectId, t.entityType, t.entityId),
  ],
);

/** Phase 2 — public share links (schema only in v1) */
export const driveShareTokens = pgTable("drive_share_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  driveObjectId: uuid("drive_object_id")
    .notNull()
    .references(() => driveObjects.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  passwordHash: text("password_hash"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
