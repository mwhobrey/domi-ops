import { requireDb } from "../lib/require-db.js";
import { importRecords } from "@whome/db";
import { and, eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  createImportS3Client,
  ensureBucket,
  homehubUploadPath,
  importFileKey,
  s3ConfigFromEnv,
  uploadFileToS3,
} from "../lib/s3-upload.js";
import type { ImportContext, MapperResult } from "./types.js";

export async function importFiles(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  let count = 0;
  try {
    const row = ctx.sqlite.prepare("SELECT COUNT(*) as c FROM file").get() as { c: number };
    count = row?.c ?? 0;
  } catch {
    result.warnings.push("file table not found");
    return result;
  }

  if (ctx.dryRun) {
    result.imported = count;
    if (!ctx.uploadsPath && count > 0) {
      result.warnings.push("dry-run: pass --uploads to copy files to S3 on live import");
    }
    return result;
  }

  if (!ctx.uploadsPath) {
    result.warnings.push("files import skipped: --uploads path required");
    return result;
  }

  const s3 = s3ConfigFromEnv();
  if (!s3) {
    result.warnings.push("files import skipped: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY required");
    return result;
  }

  const db = requireDb(ctx);
  const client = createImportS3Client(s3);
  await ensureBucket(client, s3.bucket);
  const rows = ctx.sqlite
    .prepare("SELECT id, filename, creator FROM file ORDER BY id")
    .all() as Record<string, unknown>[];

  for (const r of rows) {
    const sourceId = String(r.id);
    const [existing] = await db
      .select()
      .from(importRecords)
      .where(
        and(
          eq(importRecords.householdId, ctx.householdId),
          eq(importRecords.sourceTable, "file"),
          eq(importRecords.sourceId, sourceId),
        ),
      )
      .limit(1);
    const filename = String(r.filename);
    if (existing) {
      ctx.idMap.set(`file:${sourceId}`, importFileKey(ctx.householdId, sourceId, filename));
      result.skipped++;
      continue;
    }

    const localPath = homehubUploadPath(ctx.uploadsPath, filename);
    if (!existsSync(localPath)) {
      result.warnings.push(`file ${sourceId}: missing on disk: ${filename}`);
      continue;
    }

    const key = importFileKey(ctx.householdId, sourceId, filename);
    try {
      await uploadFileToS3(client, s3, localPath, key);
    } catch (e) {
      result.warnings.push(
        `file ${sourceId}: S3 upload failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }

    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "file",
      sourceId,
      targetTable: "s3_object",
      targetId: randomUUID(),
    });
    ctx.idMap.set(`file:${sourceId}`, key);
    result.imported++;
  }

  return result;
}
