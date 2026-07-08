#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadEnv } from "@domi-ops/config";
import { closeDb, createDb } from "@domi-ops/db";
import { bootstrapGreenfieldOwner, needsGreenfieldSetup, verifySetupToken } from "./setup.js";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      email: { type: "string", short: "e" },
      password: { type: "string", short: "p" },
      name: { type: "string", short: "n" },
      household: { type: "string", short: "h" },
      token: { type: "string", short: "t" },
      help: { type: "boolean", short: "?" },
    },
  });

  if (values.help) {
    console.log(`Usage: bootstrap:owner --email owner@example.com --password 'secret' [--name Owner] [--household "Our Home"] [--token SETUP_TOKEN]

Requires DATABASE_URL and SETUP_TOKEN in environment (or pass --token).
Fails if a household or HomeHub import already exists.`);
    process.exit(0);
  }

  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);

  try {
    if (!(await needsGreenfieldSetup(db, env))) {
      console.error("bootstrap:owner: household or import already exists — use /login instead");
      process.exit(1);
    }

    const token = values.token ?? env.SETUP_TOKEN;
    if (!verifySetupToken(env, token)) {
      console.error("bootstrap:owner: invalid or missing SETUP_TOKEN (min 16 chars in .env)");
      process.exit(1);
    }

    const email = values.email ?? positionals[0];
    const password = values.password ?? positionals[1];
    if (!email || !password) {
      console.error("bootstrap:owner: --email and --password are required");
      process.exit(1);
    }

    const result = await bootstrapGreenfieldOwner(db, env, {
      email,
      password,
      name: values.name,
      householdName: values.household,
    });

    console.log(`Created owner ${email} → household ${result.householdId}`);
    console.log("Sign in at your PUBLIC_APP_URL/login");
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
