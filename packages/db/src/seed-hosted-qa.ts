#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { closeDb, createDb, type Database } from "./client.js";
import {
  baAccounts,
  householdMembers,
  householdSubscriptions,
  households,
  notes,
  users,
} from "./schema/index.js";
import { withSystemContext } from "./tenant-context.js";

const ALPHA_SLUG = "alpha-hosted";
const BETA_SLUG = "beta-hosted";
const PASSWORD = "HostedQa2026!";

type SeedHousehold = {
  slug: string;
  name: string;
  ownerEmail: string;
  modulesEnabled: string[];
  modulesEntitled: string[];
  noteTitle: string;
};

const HOUSEHOLDS: SeedHousehold[] = [
  {
    slug: ALPHA_SLUG,
    name: "Alpha Hosted QA",
    ownerEmail: "alpha@hosted-qa.domi-ops.test",
    modulesEnabled: ["core", "school", "calendar_sync"],
    modulesEntitled: ["core", "school", "calendar_sync"],
    noteTitle: "alpha-secret-note",
  },
  {
    slug: BETA_SLUG,
    name: "Beta Hosted QA",
    ownerEmail: "beta@hosted-qa.domi-ops.test",
    modulesEnabled: ["core", "drive", "health"],
    modulesEntitled: ["core", "drive", "health"],
    noteTitle: "beta-secret-note",
  },
];

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

async function wipeHostedQa(db: Database) {
  for (const seed of HOUSEHOLDS) {
    const [household] = await db
      .select({ id: households.id })
      .from(households)
      .where(eq(households.slug, seed.slug))
      .limit(1);
    if (!household) continue;

    await db.delete(notes).where(eq(notes.householdId, household.id));
    await db.delete(householdSubscriptions).where(eq(householdSubscriptions.householdId, household.id));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, household.id));
    await db.delete(households).where(eq(households.id, household.id));

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, seed.ownerEmail))
      .limit(1);
    if (user) {
      await db.delete(baAccounts).where(eq(baAccounts.userId, user.id));
      await db.delete(users).where(eq(users.id, user.id));
    }
  }
}

async function seedHousehold(db: Database, seed: SeedHousehold, passwordHash: string) {
  const [household] = await db
    .insert(households)
    .values({
      name: seed.name,
      slug: seed.slug,
      tier: "hosted_starter",
      modulesEnabled: JSON.stringify(seed.modulesEnabled),
      storageQuotaBytes: 1_073_741_824,
      timezone: "America/Chicago",
    })
    .returning({ id: households.id });

  const [user] = await db
    .insert(users)
    .values({
      email: seed.ownerEmail,
      displayName: seed.name,
      emailVerified: true,
    })
    .returning({ id: users.id });

  await db.insert(baAccounts).values({
    userId: user.id,
    providerId: "credential",
    accountId: seed.ownerEmail,
    password: passwordHash,
  });

  const [member] = await db
    .insert(householdMembers)
    .values({
      householdId: household.id,
      userId: user.id,
      role: "owner",
      name: seed.name,
    })
    .returning({ id: householdMembers.id });

  await db.insert(householdSubscriptions).values({
    householdId: household.id,
    modulesEntitled: JSON.stringify(seed.modulesEntitled),
    status: "active",
  });

  await db.insert(notes).values({
    householdId: household.id,
    createdByUserId: user.id,
    title: seed.noteTitle,
    content: `QA fixture for ${seed.slug}`,
    visibility: "household",
  });

  return { householdId: household.id, userId: user.id, memberId: member.id };
}

async function main() {
  loadRootEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = createDb(url);
  const passwordHash = await hashPassword(PASSWORD);

  try {
    await withSystemContext(db, async (sysDb) => {
      console.log("Wiping prior hosted QA households…");
      await wipeHostedQa(sysDb);

      for (const seed of HOUSEHOLDS) {
        console.log(`Seeding ${seed.slug}…`);
        const ids = await seedHousehold(sysDb, seed, passwordHash);
        console.log(`  household=${ids.householdId} user=${ids.userId}`);
      }
    });

    console.log("\nHosted QA seed ready (DEPLOYMENT_MODE=shared).");
    console.log(`  Alpha: ${HOUSEHOLDS[0].ownerEmail} / ${PASSWORD}`);
    console.log(`  Beta:  ${HOUSEHOLDS[1].ownerEmail} / ${PASSWORD}`);
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
