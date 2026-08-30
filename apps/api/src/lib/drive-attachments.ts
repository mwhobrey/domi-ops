import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@domi-ops/db";
import { driveObjects, driveReferences } from "@domi-ops/db";
import type { AuthContext } from "@domi-ops/auth";
import { driveVisibleWhere, filenameFromDriveKey } from "./drive.js";

export type DriveAttachmentDto = {
  id: string;
  driveObjectId: string;
  title: string;
  kind: string;
  filename: string | null;
  url: string | null;
};

/** Batch-load drive attachments for a page of entities (notices, notes) keyed by entity id —
 *  shared by both callers instead of each running its own join. */
export async function loadEntityDriveAttachments(
  db: Database,
  auth: AuthContext,
  entityType: string,
  entityIds: string[],
): Promise<Map<string, DriveAttachmentDto[]>> {
  const map = new Map<string, DriveAttachmentDto[]>();
  if (entityIds.length === 0) return map;

  const rows = await db
    .select({
      id: driveReferences.id,
      entityId: driveReferences.entityId,
      driveObjectId: driveReferences.driveObjectId,
      title: driveObjects.title,
      kind: driveObjects.kind,
      url: driveObjects.url,
      s3Key: driveObjects.s3Key,
    })
    .from(driveReferences)
    .innerJoin(driveObjects, eq(driveReferences.driveObjectId, driveObjects.id))
    .where(
      and(
        eq(driveReferences.entityType, entityType),
        inArray(driveReferences.entityId, entityIds),
        driveVisibleWhere(db, auth),
      ),
    );

  for (const row of rows) {
    const list = map.get(row.entityId) ?? [];
    list.push({
      id: row.id,
      driveObjectId: row.driveObjectId,
      title: row.title,
      kind: row.kind,
      filename: row.s3Key ? filenameFromDriveKey(row.s3Key) : null,
      url: row.url,
    });
    map.set(row.entityId, list);
  }
  return map;
}
