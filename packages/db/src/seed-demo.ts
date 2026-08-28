#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, createDb } from "./client.js";
import { withHouseholdContext, withSystemContext } from "./tenant-context.js";
import { DEMO_MEMBER_PASSWORD_DEFAULT, DEMO_OWNER_EMAIL } from "./seed-demo/constants.js";
import { insertDemoHousehold, seedDemoContent } from "./seed-demo/content.js";
import { createDemoMembers, wipeDemoHousehold } from "./seed-demo/members.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadRootEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    const envPath = path.join(dir, ".env");
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        if (process.env[key] !== undefined) continue;
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

function assertAllowedToRun(): void {
  const demoMode = process.env.DEMO_MODE === "true";
  const isDev = process.env.NODE_ENV !== "production";
  const force = process.argv.includes("--force");
  if (demoMode || isDev || force) return;
  console.error(
    "Refusing to seed demo data: set DEMO_MODE=true, NODE_ENV=development, or pass --force",
  );
  process.exit(1);
}

async function main() {
  loadRootEnv();
  assertAllowedToRun();

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const password = process.env.DEMO_OWNER_PASSWORD ?? DEMO_MEMBER_PASSWORD_DEFAULT;
  if (!process.env.DEMO_OWNER_PASSWORD && process.env.NODE_ENV !== "production") {
    console.warn(
      `DEMO_OWNER_PASSWORD unset — using default demo password (${DEMO_MEMBER_PASSWORD_DEFAULT})`,
    );
  }

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey && process.env.NODE_ENV === "production") {
    console.error("ENCRYPTION_KEY is required when seeding health data in production");
    process.exit(1);
  }

  const db = createDb(url);

  try {
    // Household/member bootstrap runs under app.system_access (household doesn't exist yet, so
    // there's no app.current_household_id to scope under) — matches the same "greenfield
    // bootstrap" context the setup wizard uses, required so this script also works against the
    // restricted domi_ops_app role hosted-prod runs as (NOBYPASSRLS — see HOSTED_BETA_SETUP.md).
    const { householdId, ctx } = await withSystemContext(db, async (tx) => {
      console.log("Wiping prior Rivera demo household…");
      await wipeDemoHousehold(tx);

      console.log("Creating household…");
      const householdId = await insertDemoHousehold(tx);

      console.log("Creating members…");
      const ctx = await createDemoMembers(tx, householdId, password);

      return { householdId, ctx };
    });

    // Content tables (calendar, chores, school, health, …) are gated by household_isolation, not
    // system_bootstrap — same scoping every real API request runs under.
    console.log("Seeding module content…");
    await withHouseholdContext(db, householdId, async (tx) => {
      await seedDemoContent(tx, ctx, encryptionKey);
    });

    console.log("\nDemo household ready.");
    console.log(`  Household: ${householdId} (slug: rivera-demo)`);
    console.log(`  Login:     ${DEMO_OWNER_EMAIL}`);
    console.log(`  Password:  ${process.env.DEMO_OWNER_PASSWORD ? "(from DEMO_OWNER_PASSWORD)" : password}`);
    console.log("\nOpen /calendar (week view) or /dashboard for screenshots.");
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
