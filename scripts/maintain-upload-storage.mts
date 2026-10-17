/** Explicit operator tool: dry-run by default. Never reads the checkout's .env. */
import { GetObjectAclCommand, ListObjectsV2Command, PutObjectAclCommand } from "@aws-sdk/client-s3";
import { closeDb, createDb, withHouseholdContext } from "../packages/db/dist/index.js";
import type { Env } from "../packages/config/dist/index.js";
import { createS3Client } from "../apps/api/src/lib/s3.js";
import { cleanupAbandonedUploads } from "../apps/api/src/lib/upload-cleanup.js";
import { reconcileHouseholdStorage } from "../apps/api/src/lib/storage-reconciliation.js";

const apply = process.argv.includes("--apply");
const mode = process.argv[2];
const env = {
  S3_ENDPOINT: process.env.S3_ENDPOINT, S3_BUCKET: process.env.S3_BUCKET,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY, S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  S3_REGION: process.env.S3_REGION || "us-east-1", S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE !== "false",
} as Env;
const client = createS3Client(env);
if (!client || !env.S3_BUCKET) throw new Error("Explicit S3 environment configuration is required");

if (mode === "school-acls") {
  let continuationToken: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: "school/", ContinuationToken: continuationToken }));
    for (const object of page.Contents ?? []) {
      if (!object.Key) continue;
      const acl = await client.send(new GetObjectAclCommand({ Bucket: env.S3_BUCKET, Key: object.Key }));
      const publiclyGranted = acl.Grants?.some(({ Grantee }) => Grantee?.URI?.endsWith("/AllUsers") || Grantee?.URI?.endsWith("/AuthenticatedUsers"));
      if (!publiclyGranted) continue;
      // Private ACL does not repair a public bucket policy; inspect that separately.
      console.log(JSON.stringify({ key: object.Key, action: apply ? "make-private" : "would-make-private" }));
      if (apply) await client.send(new PutObjectAclCommand({ Bucket: env.S3_BUCKET, Key: object.Key, ACL: "private" }));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
} else if (mode === "abandoned" || mode === "reconcile") {
  const url = process.env.UPLOAD_MAINTENANCE_DATABASE_URL;
  const householdId = process.env.UPLOAD_MAINTENANCE_HOUSEHOLD_ID;
  if (!url || !householdId) throw new Error("Explicit UPLOAD_MAINTENANCE_DATABASE_URL and UPLOAD_MAINTENANCE_HOUSEHOLD_ID are required");
  const db = createDb(url);
  try {
    // A full day after grant expiry gives interrupted clients a conservative review window.
    const cutoff = new Date(Date.now() - 86400000);
    const rows = await withHouseholdContext(db, householdId, (tx) => mode === "reconcile" ? reconcileHouseholdStorage(tx, env, householdId, apply) : cleanupAbandonedUploads(tx as typeof db, env, householdId, cutoff, apply));
    console.log(JSON.stringify({ mode, apply, householdId, cutoff, uploads: rows }));
  } finally { await closeDb(db); }
} else {
  throw new Error("Usage: tsx scripts/maintain-upload-storage.mts school-acls|abandoned|reconcile [--apply]");
}
client.destroy();
