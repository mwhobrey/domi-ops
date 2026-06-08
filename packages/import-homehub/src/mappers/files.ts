import { requireDb } from "../lib/require-db.js";
import { driveFolders, driveObjects, importRecords } from "@whome/db";
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

const IMPORTS_FOLDER_NAME = "Imports";

async function ensureImportsFolder(
  ctx: ImportContext,
  db: ReturnType<typeof requireDb>,
): Promise<string> {
  const cached = ctx.idMap.get("drive_folder:imports");
  if (cached) return cached;

  const [existing] = await db
    .select({ id: driveFolders.id })
    .from(driveFolders)
    .where(
      and(
        eq(driveFolders.householdId, ctx.householdId),
        eq(driveFolders.name, IMPORTS_FOLDER_NAME),
      ),
    )
    .limit(1);
  if (existing) {
    ctx.idMap.set("drive_folder:imports", existing.id);
    return existing.id;
  }

  const folderId = randomUUID();
  await db.insert(driveFolders).values({
    id: folderId,
    householdId: ctx.householdId,
    parentId: null,
    name: IMPORTS_FOLDER_NAME,
  });
  ctx.idMap.set("drive_folder:imports", folderId);
  return folderId;
}

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
  const importsFolderId = await ensureImportsFolder(ctx, db);

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
    const s3Key = importFileKey(ctx.householdId, sourceId, filename);
    if (existing) {
      ctx.idMap.set(`file:${sourceId}`, s3Key);
      result.skipped++;
      continue;
    }

    const localPath = homehubUploadPath(ctx.uploadsPath, filename);
    if (!existsSync(localPath)) {
      result.warnings.push(`file ${sourceId}: missing on disk: ${filename}`);
      continue;
    }

    try {
      await uploadFileToS3(client, s3, localPath, s3Key);
    } catch (e) {
      result.warnings.push(
        `file ${sourceId}: S3 upload failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }

    const objectId = randomUUID();
    const creator = r.creator != null ? String(r.creator).trim() : null;
    await db.insert(driveObjects).values({
      id: objectId,
      householdId: ctx.householdId,
      folderId: importsFolderId,
      kind: "file",
      title: filename,
      s3Key,
      contentType: "application/octet-stream",
      byteSize: 0,
      visibility: "household",
      createdByDisplayName: creator || null,
    });

    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "file",
      sourceId,
      targetTable: "drive_objects",
      targetId: objectId,
    });
    ctx.idMap.set(`file:${sourceId}`, s3Key);
    result.imported++;
  }

  return result;
}
