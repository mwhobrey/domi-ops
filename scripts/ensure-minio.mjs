#!/usr/bin/env node
/** Create S3 bucket if missing (local MinIO after dev:reset). */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const { loadEnv } = await import(pathToFileURL(path.join(root, "packages/config/dist/index.js")).href);
const { ensureS3Bucket } = await import(pathToFileURL(path.join(root, "apps/api/dist/lib/s3.js")).href);

const env = loadEnv();
if (!env.S3_ENDPOINT) {
  console.log("ensure-minio: S3_ENDPOINT unset — skipping");
  process.exit(0);
}

try {
  await ensureS3Bucket(env);
  console.log(`ensure-minio: bucket "${env.S3_BUCKET}" ready`);
} catch (err) {
  console.error("ensure-minio failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
