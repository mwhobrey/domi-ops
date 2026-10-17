/** No dotenv: credentials and keys must be supplied explicitly by the operator. */
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { closeDb, createDb } from "../packages/db/dist/index.js";
import { exportHouseholdArchive, restoreHouseholdArchive, type ArchiveObjectStore } from "../packages/db/src/household-archive.js";
import { createS3Client } from "../apps/api/src/lib/s3.js";
import type { Env } from "../packages/config/dist/index.js";

const [mode, directory] = process.argv.slice(2);
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
if (!["export", "restore"].includes(mode) || !directory) throw new Error("Usage: tsx scripts/household-archive.mts export|restore <new-output-directory|archive-directory> [--apply]");
const env = { S3_ENDPOINT: required("ARCHIVE_S3_ENDPOINT"), S3_BUCKET: required("ARCHIVE_S3_BUCKET"), S3_ACCESS_KEY: required("ARCHIVE_S3_ACCESS_KEY"), S3_SECRET_KEY: required("ARCHIVE_S3_SECRET_KEY"), S3_REGION: process.env.ARCHIVE_S3_REGION || "us-east-1", S3_FORCE_PATH_STYLE: process.env.ARCHIVE_S3_FORCE_PATH_STYLE !== "false" } as Env;
const client = createS3Client(env)!;
const store: ArchiveObjectStore = {
  async read(key) {
    const object = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    if (!object.Body) throw new Error("Archive object is missing");
    return { body: object.Body as AsyncIterable<Uint8Array>, contentType: object.ContentType };
  },
  async write(key, body, bytes, contentType) {
    await client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: Readable.from(body), ContentLength: bytes, ContentType: contentType, ACL: "private", IfNoneMatch: "*" }));
  },
  async assertEmpty(prefixes) {
    for (const prefix of prefixes) {
      const page = await client.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix, MaxKeys: 1 }));
      if (page.Contents?.length) throw new Error("Destination object namespace is not empty; restore refused");
    }
  },
};
const db = createDb(required("ARCHIVE_DATABASE_URL"));
try {
  const common = { db, directory, store, encryptionKey: required("ARCHIVE_INSTANCE_ENCRYPTION_KEY"), archiveKey: required("ARCHIVE_KEY") };
  if (mode === "export" && !process.argv.includes("--approved-private-data-export")) throw new Error("Full archives contain every member's private records. Complete the documented identity, recipient, and affected-adult authorization checks, then use --approved-private-data-export.");
  const receipt = mode === "export" ? await exportHouseholdArchive({ ...common, householdId: required("ARCHIVE_HOUSEHOLD_ID") }) : await restoreHouseholdArchive({ ...common, apply: process.argv.includes("--apply") });
  console.log(JSON.stringify({ mode, ...receipt }));
} finally { await closeDb(db); client.destroy(); }
