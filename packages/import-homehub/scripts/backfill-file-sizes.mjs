#!/usr/bin/env node
// One-time repair for Drive files imported from HomeHub before WHO-332.
//
// The files mapper used to insert every imported file with byte_size 0 and content type
// application/octet-stream, and never counted them toward households.storage_used_bytes. The
// files themselves are fine in S3, but Settings showed "0 B used" and the Drive quota ignored
// them. This script reads each zero-byte file's real size from S3, fixes the content type from
// the filename, then recomputes every household's storage_used_bytes as the sum of its Drive
// file sizes (the invariant Drive uploads/deletes maintain).
//
// Safe to re-run. Pass --dry-run to report without writing.
//
// Usage (needs the import package built — `npm run build -w @domi-ops/import-homehub`):
//   DATABASE_URL=<admin url> S3_ENDPOINT=… S3_ACCESS_KEY=… S3_SECRET_KEY=… [S3_BUCKET=…] \
//     node packages/import-homehub/scripts/backfill-file-sizes.mjs [--dry-run]

import { HeadObjectCommand } from "@aws-sdk/client-s3";
import postgres from "postgres";
import { contentTypeForFilename } from "../dist/lib/content-type.js";
import { createImportS3Client, s3ConfigFromEnv } from "../dist/lib/s3-upload.js";

const dryRun = process.argv.includes("--dry-run");
const databaseUrl = process.env.DATABASE_URL;
const s3 = s3ConfigFromEnv();
if (!databaseUrl || !s3) {
  console.error("DATABASE_URL and S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY are required");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
const client = createImportS3Client(s3);

const rows = await sql`
  select id, title, s3_key, content_type
  from drive_objects
  where kind = 'file' and coalesce(byte_size, 0) = 0 and s3_key is not null
`;
console.log(`${rows.length} zero-byte Drive file(s) to check${dryRun ? " (dry run)" : ""}`);

let fixed = 0;
for (const row of rows) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: s3.bucket, Key: row.s3_key }));
    const size = Number(head.ContentLength ?? 0);
    const contentType =
      row.content_type && row.content_type !== "application/octet-stream"
        ? row.content_type
        : contentTypeForFilename(row.title ?? row.s3_key);
    console.log(`  ${row.title}: ${size} bytes, ${contentType}`);
    if (!dryRun && size > 0) {
      await sql`update drive_objects set byte_size = ${size}, content_type = ${contentType} where id = ${row.id}`;
      fixed += 1;
    }
  } catch (e) {
    console.warn(`  ${row.title}: S3 head failed (${e?.name ?? e})`);
  }
}

const totals = await sql`
  select h.id, h.name, h.storage_used_bytes as before,
    coalesce((select sum(d.byte_size) from drive_objects d where d.household_id = h.id), 0)::bigint as after
  from households h
`;
for (const t of totals) {
  if (String(t.before) !== String(t.after)) {
    console.log(`household ${t.name ?? t.id}: storage_used_bytes ${t.before} -> ${t.after}`);
  }
}
if (!dryRun) {
  await sql`
    update households h
    set storage_used_bytes = coalesce(
      (select sum(d.byte_size) from drive_objects d where d.household_id = h.id), 0)
  `;
}

console.log(dryRun ? "Dry run complete; nothing written." : `Updated ${fixed} file(s); storage totals recomputed.`);
await sql.end();
