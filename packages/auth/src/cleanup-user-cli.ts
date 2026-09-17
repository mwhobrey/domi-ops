#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadEnv } from "@domi-ops/config";
import { closeDb, createDb } from "@domi-ops/db";
import {
  attachUserToHousehold,
  deleteOrphanedUsers,
  deleteUser,
  findUser,
  listAllUsers,
} from "./cleanup-user.js";

async function main() {
  const { values } = parseArgs({
    allowPositionals: true,
    options: {
      email: { type: "string", short: "e" },
      id: { type: "string", short: "i" },
      username: { type: "string", short: "u" },
      list: { type: "boolean", short: "l" },
      delete: { type: "boolean", short: "d" },
      "delete-orphans": { type: "boolean" },
      attach: { type: "string" }, // householdId
      role: { type: "string" },
      help: { type: "boolean", short: "?" },
    },
  });

  if (values.help) {
    console.log(`Domi Ops User Cleanup CLI

Usage:
  npm run user:cleanup -- [options]

Options:
  --list, -l                  List all users in database and their status
  --email <email>, -e         Lookup user by email address
  --username <user>, -u       Lookup user by username
  --id <userId>, -i           Lookup user by UUID
  --delete, -d                Delete the specified user (must combine with --email, --username, or --id)
  --delete-orphans            Delete ALL users without a household membership
  --attach <householdId>      Attach specified user to a household
  --role <role>               Role when attaching to household (default: member)
  --help, -?                  Show this help text
`);
    process.exit(0);
  }

  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);

  try {
    if (values["delete-orphans"]) {
      console.log("Searching for orphaned users (users without a household)...");
      const deleted = await deleteOrphanedUsers(db);
      if (deleted.length === 0) {
        console.log("No orphaned users found.");
      } else {
        console.log(`Successfully deleted ${deleted.length} orphaned user(s):`);
        for (const u of deleted) {
          console.log(`  - [${u.id}] ${u.email ?? u.username ?? "no-identifier"}`);
        }
      }
      return;
    }

    const queryTarget = values.email || values.username || values.id;

    if (!queryTarget) {
      // Default: List all users
      console.log("Listing all registered users:\n");
      const users = await listAllUsers(db);

      if (users.length === 0) {
        console.log("No users found in database.");
        return;
      }

      for (const u of users) {
        const identifier = u.email ?? (u.username ? `@${u.username}` : "no-identifier");
        const status = u.isOrphaned
          ? "⚠️ ORPHANED (No Household)"
          : `Household: ${u.householdName ?? u.householdId} (${u.role})`;
        const providers = u.accountProviders.length > 0 ? u.accountProviders.join(", ") : "none";

        console.log(`• ID: ${u.id}`);
        console.log(`  Name / Identifier: ${u.displayName ?? "N/A"} (${identifier})`);
        console.log(`  Status: ${status}`);
        console.log(`  Auth Providers: ${providers} | Active Sessions: ${u.sessionCount}`);
        console.log(`  Created: ${u.createdAt.toISOString()}\n`);
      }
      return;
    }

    const targetUser = await findUser(db, {
      email: values.email,
      username: values.username,
      id: values.id,
    });

    if (!targetUser) {
      console.error(`User not found matching: ${queryTarget}`);
      process.exit(1);
    }

    console.log(`Found User:`);
    console.log(`  ID: ${targetUser.id}`);
    console.log(`  Email: ${targetUser.email ?? "N/A"}`);
    console.log(`  Username: ${targetUser.username ?? "N/A"}`);
    console.log(`  Display Name: ${targetUser.displayName ?? "N/A"}`);
    console.log(
      `  Household: ${targetUser.householdName ?? targetUser.householdId ?? "NONE (Orphaned)"}`,
    );
    console.log(`  Role: ${targetUser.role ?? "N/A"}`);
    console.log(`  Sessions: ${targetUser.sessionCount}`);

    if (values.delete) {
      console.log(`\nDeleting user ${targetUser.id} (${targetUser.email ?? targetUser.username})...`);
      const result = await deleteUser(db, targetUser.id);
      if (result.deleted) {
        console.log("User successfully deleted.");
      } else {
        console.error("Failed to delete user.");
      }
      return;
    }

    if (values.attach) {
      const householdId = values.attach;
      const role = (values.role as any) ?? "member";
      console.log(`\nAttaching user to household ${householdId} with role '${role}'...`);
      const res = await attachUserToHousehold(db, targetUser.id, householdId, role);
      console.log(`Successfully attached to household '${res.householdName}'!`);
      return;
    }
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
