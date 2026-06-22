import { randomUUID } from "node:crypto";
import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import { driveFolders, driveObjects, households } from "@whome/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { normalizeFolderName } from "./drive-folders.js";
import { checkDriveUploadQuota, driveObjectKey } from "./drive.js";
import { putObject } from "./s3.js";

async function findChildFolder(
  db: Database,
  householdId: string,
  parentId: string | null,
  name: string,
): Promise<string | null> {
  const normalized = normalizeFolderName(name);
  if (!normalized) return null;
  const [row] = await db
    .select({ id: driveFolders.id })
    .from(driveFolders)
    .where(
      and(
        eq(driveFolders.householdId, householdId),
        parentId ? eq(driveFolders.parentId, parentId) : isNull(driveFolders.parentId),
        eq(driveFolders.name, normalized),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function ensureFolderPath(
  db: Database,
  householdId: string,
  segments: string[],
): Promise<string | null> {
  let parentId: string | null = null;
  for (const segment of segments) {
    const existing = await findChildFolder(db, householdId, parentId, segment);
    if (existing) {
      parentId = existing;
      continue;
    }
    const normalized = normalizeFolderName(segment);
    if (!normalized) return null;
    const inserted: { id: string }[] = await db
      .insert(driveFolders)
      .values({ householdId, name: normalized, parentId })
      .returning({ id: driveFolders.id });
    const newId = inserted[0]?.id;
    if (!newId) return null;
    parentId = newId;
  }
  return parentId;
}

export async function saveReportToWhomeDrive(params: {
  db: Database;
  env: Env;
  householdId: string;
  userId: string;
  moduleLabel: string;
  filename: string;
  body: Buffer;
  mimeType: string;
  createdByLabel: string;
}) {
  const byteSize = params.body.byteLength;
  if (byteSize > params.env.DRIVE_UPLOAD_MAX_BYTES) {
    throw new Error("file_too_large");
  }
  const quota = await checkDriveUploadQuota(params.db, params.env, params.householdId, byteSize);
  if (quota === "quota_exceeded") throw new Error("quota_exceeded");

  const folderId = await ensureFolderPath(params.db, params.householdId, [
    "Reports",
    params.moduleLabel,
  ]);

  const objectId = randomUUID();
  const key = driveObjectKey(params.householdId, objectId, params.filename);
  await putObject(params.env, key, params.body, params.mimeType);

  const [object] = await params.db
    .insert(driveObjects)
    .values({
      id: objectId,
      householdId: params.householdId,
      folderId,
      kind: "file",
      title: params.filename.replace(/\.[^.]+$/, ""),
      s3Key: key,
      contentType: params.mimeType,
      byteSize,
      visibility: "household",
      createdByUserId: params.userId,
      createdByDisplayName: params.createdByLabel,
    })
    .returning();

  await params.db
    .update(households)
    .set({
      storageUsedBytes: sql`greatest(0, ${households.storageUsedBytes} + ${byteSize})`,
    })
    .where(eq(households.id, params.householdId));

  return object;
}
