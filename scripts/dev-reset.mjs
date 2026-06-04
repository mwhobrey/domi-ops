#!/usr/bin/env node
/**
 * Wipe local dev Docker volumes (Postgres + MinIO), restart infra, flush Redis, re-run migrations.
 * Usage: npm run dev:reset
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, { allowFail = false } = {}) {
  const label = [cmd, ...args].join(" ");
  console.log(`\n> ${label}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0 && !allowFail) {
    console.error(`\nCommand failed (exit ${result.status}): ${label}`);
    process.exit(result.status ?? 1);
  }
  return result.status ?? 0;
}

function hasDocker() {
  const r = spawnSync("docker", ["version"], { cwd: root, stdio: "ignore" });
  return r.status === 0;
}

console.log("whome dev:reset — fresh Postgres schema + empty Redis/MinIO volumes\n");

if (!hasDocker()) {
  console.error("Docker is not available. Install Docker Desktop and try again.");
  process.exit(1);
}

run("docker", ["compose", "down", "-v"]);
run("docker", ["compose", "up", "-d", "postgres", "redis", "minio", "--wait"]);
run("docker", ["compose", "exec", "-T", "redis", "redis-cli", "FLUSHALL"], { allowFail: true });
run("npm", ["run", "db:migrate"]);

console.log("\nDone. Data is empty — log in again or run import:homehub.");
console.log("Start app: npm run dev  (infra already up: postgres, redis, minio)\n");
