import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthContext } from "@whome/auth";
import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import {
  driveObjects,
  driveReferences,
  driveShares,
  households,
  householdMembers,
} from "@whome/db";
import { and, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { canWriteDriveReferenceEntity } from "../lib/drive-reference-auth.js";
import {
  canReadDrive,
  canWriteDrive,
  loadHouseholdDrivePermissions,
} from "../lib/drive-permissions.js";
import { requireHouseholdModule } from "../lib/household-modules.js";
import {
  checkDriveUploadQuota,
  collectDriveTagSuggestions,
  driveObjectKey,
  filenameFromDriveKey,
  isDriveKeyForHousehold,
  normalizeDriveKind,
  normalizeDriveTitle,
  normalizeDriveVisibility,
  objectIdFromDriveKey,
  parseDriveTagsJson,
  driveVisibleWhere,
  serializeDriveTagsJson,
  type DriveVisibility,
  validateDriveObjectFields,
} from "../lib/drive.js";
import {
  createS3Client,
  deleteObject,
  ensureS3ReadyOnce,
  getObjectBuffer,
  presignedPutUrl,
  contentTypeFromKey,
} from "../lib/s3.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

const PRESIGN_EXPIRY_SEC = 15 * 60;

function posterLabel(auth: AuthContext): string {
  return auth.name?.trim() || auth.email || auth.username || "Member";
}

type DriveRow = typeof driveObjects.$inferSelect;

function driveMutableWhere(id: string, auth: AuthContext) {
  return and(
    eq(driveObjects.id, id),
    eq(driveObjects.householdId, auth.householdId),
    or(eq(driveObjects.visibility, "household"), eq(driveObjects.createdByUserId, auth.userId)),
  );
}

function driveListWhere(
  db: Database,
  auth: AuthContext,
  q?: string,
  tag?: string,
  pinnedOnly?: boolean,
) {
  const conditions = [driveVisibleWhere(db, auth)];
  if (pinnedOnly) {
    conditions.push(eq(driveObjects.pinned, true));
  }
  const trimmedQ = q?.trim();
  if (trimmedQ) {
    conditions.push(
      or(
        ilike(driveObjects.title, `%${trimmedQ}%`),
        ilike(driveObjects.description, `%${trimmedQ}%`),
        ilike(driveObjects.s3Key, `%${trimmedQ}%`),
      ),
    );
  }
  const trimmedTag = tag?.trim();
  if (trimmedTag) {
    conditions.push(
      sql`exists (
        select 1 from jsonb_array_elements_text(coalesce(${driveObjects.tagsJson}::jsonb, '[]'::jsonb)) as drive_tag
        where lower(drive_tag) = lower(${trimmedTag})
      )`,
    );
  }
  return and(...conditions);
}

async function loadDriveShareMap(db: Database, objectIds: string[]) {
  const map = new Map<string, string[]>();
  if (objectIds.length === 0) return map;
  const rows = await db
    .select({ driveObjectId: driveShares.driveObjectId, memberId: driveShares.memberId })
    .from(driveShares)
    .where(inArray(driveShares.driveObjectId, objectIds));
  for (const row of rows) {
    const list = map.get(row.driveObjectId) ?? [];
    list.push(row.memberId);
    map.set(row.driveObjectId, list);
  }
  return map;
}

async function validateShareMemberIds(
  db: Database,
  householdId: string,
  memberIds: string[],
  excludeMemberId?: string,
) {
  const unique = [...new Set(memberIds.filter((id) => id && id !== excludeMemberId))];
  if (unique.length === 0) return [];
  const rows = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(
      and(eq(householdMembers.householdId, householdId), inArray(householdMembers.id, unique)),
    );
  const valid = new Set(rows.map((r) => r.id));
  return unique.filter((id) => valid.has(id));
}

async function replaceDriveShares(db: Database, objectId: string, memberIds: string[]) {
  await db.delete(driveShares).where(eq(driveShares.driveObjectId, objectId));
  if (memberIds.length === 0) return;
  await db.insert(driveShares).values(
    memberIds.map((memberId) => ({
      driveObjectId: objectId,
      memberId,
    })),
  );
}

function serializeDriveObject(
  row: DriveRow,
  auth: AuthContext,
  shareMap: Map<string, string[]>,
) {
  const sharedMemberIds = shareMap.get(row.id) ?? [];
  const isOwnedByMe = row.createdByUserId === auth.userId;
  const sharedWithMe =
    row.visibility === "private" && !isOwnedByMe && sharedMemberIds.includes(auth.memberId);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    url: row.url,
    s3Key: row.s3Key,
    contentType: row.contentType,
    byteSize: row.byteSize,
    filename: row.s3Key ? filenameFromDriveKey(row.s3Key) : null,
    pinned: row.pinned,
    tags: parseDriveTagsJson(row.tagsJson),
    visibility: row.visibility,
    folderId: row.folderId,
    createdByUserId: row.createdByUserId,
    createdByDisplayName: row.createdByDisplayName,
    createdAt: row.createdAt,
    isOwnedByMe,
    sharedWithMe,
    sharedMemberIds: isOwnedByMe ? sharedMemberIds : undefined,
  };
}

async function adjustHouseholdStorage(
  db: Database,
  householdId: string,
  deltaBytes: number,
): Promise<void> {
  if (!deltaBytes) return;
  await db
    .update(households)
    .set({
      storageUsedBytes: sql`greatest(0, ${households.storageUsedBytes} + ${deltaBytes})`,
    })
    .where(eq(households.id, householdId));
}

async function driveAccessForAuth(db: Database, auth: AuthContext) {
  const permissions = await loadHouseholdDrivePermissions(db, auth.householdId);
  return {
    permissions,
    read: canReadDrive(auth.role, permissions),
    write: canWriteDrive(auth.role, permissions),
  };
}

export function driveRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));
  app.use("*", requireHouseholdModule(db, env, "drive"));

  app.get("/access", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    return c.json({
      read: access.read,
      write: access.write,
      permissions: access.permissions,
    });
  });

  app.post("/presign", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.write) return c.json({ error: "forbidden_drive_write" }, 403);
    if (!createS3Client(env) || !env.S3_BUCKET) {
      return c.json({ error: "s3_not_configured" }, 503);
    }
    const body = await c.req.json<{
      filename?: string;
      contentType?: string;
      byteSize?: number;
    }>();
    if (!body.filename?.trim()) return c.json({ error: "filename_required" }, 400);

    const byteSize = body.byteSize != null ? Number(body.byteSize) : null;
    if (byteSize != null && (!Number.isFinite(byteSize) || byteSize < 0)) {
      return c.json({ error: "invalid_byte_size" }, 400);
    }
    if (byteSize != null && byteSize > env.DRIVE_UPLOAD_MAX_BYTES) {
      return c.json({ error: "file_too_large" }, 400);
    }
    if (byteSize != null) {
      const quota = await checkDriveUploadQuota(db, env, auth.householdId, byteSize);
      if (quota === "quota_exceeded") return c.json({ error: "quota_exceeded" }, 400);
    }

    try {
      await ensureS3ReadyOnce(env);
    } catch {
      return c.json({ error: "s3_not_configured" }, 503);
    }

    const objectId = randomUUID();
    const key = driveObjectKey(auth.householdId, objectId, body.filename.trim());
    const contentType = body.contentType?.trim() || "application/octet-stream";
    const uploadUrl = await presignedPutUrl(env, key, contentType, PRESIGN_EXPIRY_SEC);
    return c.json({ uploadUrl, key, objectId });
  });

  app.get("/tags/suggestions", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.read) return c.json({ error: "forbidden_drive_read" }, 403);
    const q = c.req.query("q")?.trim() ?? "";
    const suggestions = await collectDriveTagSuggestions(db, auth.householdId, q);
    return c.json({ suggestions });
  });

  app.get("/objects", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.read) return c.json({ error: "forbidden_drive_read" }, 403);
    const q = c.req.query("q")?.trim();
    const tag = c.req.query("tag")?.trim();
    const pinnedOnly = c.req.query("pinned") === "1" || c.req.query("pinned") === "true";
    const rows = await db
      .select()
      .from(driveObjects)
      .where(driveListWhere(db, auth, q, tag, pinnedOnly))
      .orderBy(desc(driveObjects.pinned), desc(driveObjects.createdAt))
      .limit(50);
    const shareMap = await loadDriveShareMap(
      db,
      rows.filter((r) => r.visibility === "private").map((r) => r.id),
    );
    return c.json({ objects: rows.map((row) => serializeDriveObject(row, auth, shareMap)) });
  });

  app.post("/objects", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.write) return c.json({ error: "forbidden_drive_write" }, 403);
    const body = await c.req.json<{
      id?: string;
      kind?: string;
      title?: string;
      description?: string | null;
      url?: string | null;
      s3Key?: string | null;
      contentType?: string | null;
      byteSize?: number | null;
      pinned?: boolean;
      tags?: string[];
      visibility?: DriveVisibility;
      sharedMemberIds?: string[];
      folderId?: string | null;
    }>();

    const kind = normalizeDriveKind(body.kind);
    if (!kind) return c.json({ error: "invalid_kind" }, 400);

    const title = normalizeDriveTitle(body.title);
    if (!title) return c.json({ error: "title_required" }, 400);

    const fieldError = validateDriveObjectFields(kind, body);
    if (fieldError) return c.json({ error: fieldError }, 400);

    if (kind === "file") {
      const s3Key = body.s3Key!.trim();
      if (!isDriveKeyForHousehold(auth.householdId, s3Key)) {
        return c.json({ error: "invalid_s3_key" }, 400);
      }
      const keyObjectId = objectIdFromDriveKey(auth.householdId, s3Key);
      if (body.id && body.id !== keyObjectId) {
        return c.json({ error: "object_id_mismatch" }, 400);
      }
      if (body.byteSize! > env.DRIVE_UPLOAD_MAX_BYTES) {
        return c.json({ error: "file_too_large" }, 400);
      }
      const quota = await checkDriveUploadQuota(db, env, auth.householdId, body.byteSize!);
      if (quota === "quota_exceeded") return c.json({ error: "quota_exceeded" }, 400);
    }

    const visibility = normalizeDriveVisibility(body.visibility);
    const objectId =
      kind === "file" && body.id
        ? body.id
        : kind === "file" && body.s3Key
          ? objectIdFromDriveKey(auth.householdId, body.s3Key.trim())!
          : randomUUID();

    const [row] = await db
      .insert(driveObjects)
      .values({
        id: objectId,
        householdId: auth.householdId,
        folderId: body.folderId ?? null,
        kind,
        title,
        description: body.description?.trim() || null,
        url: kind === "link" ? body.url!.trim() : null,
        s3Key: kind === "file" ? body.s3Key!.trim() : null,
        contentType: kind === "file" ? body.contentType!.trim() : null,
        byteSize: kind === "file" ? Math.floor(body.byteSize!) : null,
        pinned: Boolean(body.pinned),
        tagsJson: serializeDriveTagsJson(body.tags ?? []),
        visibility,
        createdByUserId: auth.userId,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();

    if (kind === "file" && row.byteSize) {
      await adjustHouseholdStorage(db, auth.householdId, row.byteSize);
    }

    let sharedMemberIds: string[] = [];
    if (visibility === "private" && Array.isArray(body.sharedMemberIds)) {
      sharedMemberIds = await validateShareMemberIds(
        db,
        auth.householdId,
        body.sharedMemberIds,
        auth.memberId,
      );
      await replaceDriveShares(db, row.id, sharedMemberIds);
    }

    const shareMap = new Map<string, string[]>([[row.id, sharedMemberIds]]);
    return c.json({ object: serializeDriveObject(row, auth, shareMap) }, 201);
  });

  app.patch("/objects/:id", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.write) return c.json({ error: "forbidden_drive_write" }, 403);
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      description?: string | null;
      url?: string | null;
      pinned?: boolean;
      tags?: string[];
      visibility?: DriveVisibility;
      sharedMemberIds?: string[];
      folderId?: string | null;
    }>();

    const [existing] = await db
      .select()
      .from(driveObjects)
      .where(driveMutableWhere(id, auth))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const patch: Partial<typeof driveObjects.$inferInsert> = {};
    if (body.title !== undefined) {
      const title = normalizeDriveTitle(body.title);
      if (!title) return c.json({ error: "title_required" }, 400);
      patch.title = title;
    }
    if (body.description !== undefined) {
      patch.description = body.description?.trim() || null;
    }
    if (body.pinned !== undefined) {
      patch.pinned = Boolean(body.pinned);
    }
    if (body.tags !== undefined) {
      patch.tagsJson = serializeDriveTagsJson(body.tags);
    }
    if (body.folderId !== undefined) {
      patch.folderId = body.folderId;
    }
    if (body.visibility !== undefined) {
      const visibility = normalizeDriveVisibility(body.visibility);
      patch.visibility = visibility;
      if (visibility === "private") {
        patch.createdByUserId = auth.userId;
      }
    }
    if (existing.kind === "link" && body.url !== undefined) {
      const url = body.url?.trim();
      if (!url) return c.json({ error: "url_required" }, 400);
      try {
        new URL(url);
      } catch {
        return c.json({ error: "invalid_url" }, 400);
      }
      patch.url = url;
    }

    const hasShareUpdate = body.sharedMemberIds !== undefined;
    if (Object.keys(patch).length === 0 && !hasShareUpdate) {
      return c.json({ error: "no_changes" }, 400);
    }

    const [row] =
      Object.keys(patch).length > 0
        ? await db
            .update(driveObjects)
            .set(patch)
            .where(driveMutableWhere(id, auth))
            .returning()
        : [existing];

    if (!row) return c.json({ error: "not_found" }, 404);

    if (row.visibility === "household") {
      await replaceDriveShares(db, row.id, []);
    } else if (hasShareUpdate) {
      const sharedMemberIds = await validateShareMemberIds(
        db,
        auth.householdId,
        body.sharedMemberIds ?? [],
        auth.memberId,
      );
      await replaceDriveShares(db, row.id, sharedMemberIds);
    }

    const shareMap = await loadDriveShareMap(
      db,
      row.visibility === "private" ? [row.id] : [],
    );
    return c.json({ object: serializeDriveObject(row, auth, shareMap) });
  });

  app.delete("/objects/:id", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.write) return c.json({ error: "forbidden_drive_write" }, 403);
    const id = c.req.param("id");

    const [existing] = await db
      .select()
      .from(driveObjects)
      .where(driveMutableWhere(id, auth))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const [row] = await db
      .delete(driveObjects)
      .where(driveMutableWhere(id, auth))
      .returning({ id: driveObjects.id });
    if (!row) return c.json({ error: "not_found" }, 404);

    if (existing.kind === "file" && existing.s3Key) {
      await deleteObject(env, existing.s3Key);
      if (existing.byteSize) {
        await adjustHouseholdStorage(db, auth.householdId, -existing.byteSize);
      }
    }

    return c.json({ ok: true });
  });

  app.get("/objects/:id/file", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.read) return c.json({ error: "forbidden_drive_read" }, 403);
    const id = c.req.param("id");

    const [row] = await db
      .select()
      .from(driveObjects)
      .where(and(eq(driveObjects.id, id), driveVisibleWhere(db, auth)))
      .limit(1);
    if (!row || row.kind !== "file" || !row.s3Key) {
      return c.json({ error: "not_found" }, 404);
    }

    const buf = await getObjectBuffer(env, row.s3Key);
    if (!buf) return c.json({ error: "not_found" }, 404);

    const contentType = row.contentType?.trim() || contentTypeFromKey(row.s3Key);
    const filename = filenameFromDriveKey(row.s3Key);
    return new Response(buf, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  app.get("/references", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.read) return c.json({ error: "forbidden_drive_read" }, 403);
    const entityType = c.req.query("entityType")?.trim();
    const entityId = c.req.query("entityId")?.trim();
    if (!entityType || !entityId) {
      return c.json({ error: "entity_type_and_id_required" }, 400);
    }

    const rows = await db
      .select({
        id: driveReferences.id,
        driveObjectId: driveReferences.driveObjectId,
        entityType: driveReferences.entityType,
        entityId: driveReferences.entityId,
        createdAt: driveReferences.createdAt,
        object: driveObjects,
      })
      .from(driveReferences)
      .innerJoin(driveObjects, eq(driveReferences.driveObjectId, driveObjects.id))
      .where(
        and(
          eq(driveReferences.entityType, entityType),
          eq(driveReferences.entityId, entityId),
          eq(driveObjects.householdId, auth.householdId),
          driveVisibleWhere(db, auth),
        ),
      );

    const shareMap = await loadDriveShareMap(
      db,
      rows.filter((r) => r.object.visibility === "private").map((r) => r.object.id),
    );

    return c.json({
      references: rows.map((row) => ({
        id: row.id,
        driveObjectId: row.driveObjectId,
        entityType: row.entityType,
        entityId: row.entityId,
        createdAt: row.createdAt,
        object: serializeDriveObject(row.object, auth, shareMap),
      })),
    });
  });

  app.post("/references", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.read) return c.json({ error: "forbidden_drive_read" }, 403);
    const body = await c.req.json<{
      driveObjectId?: string;
      entityType?: string;
      entityId?: string;
    }>();
    const driveObjectId = body.driveObjectId?.trim();
    const entityType = body.entityType?.trim();
    const entityId = body.entityId?.trim();
    if (!driveObjectId || !entityType || !entityId) {
      return c.json({ error: "drive_object_entity_required" }, 400);
    }

    const canWriteEntity = await canWriteDriveReferenceEntity(db, auth, entityType, entityId);
    if (!canWriteEntity) return c.json({ error: "forbidden_entity_write" }, 403);

    const [object] = await db
      .select()
      .from(driveObjects)
      .where(and(eq(driveObjects.id, driveObjectId), driveVisibleWhere(db, auth)))
      .limit(1);
    if (!object) return c.json({ error: "drive_object_not_found" }, 404);

    try {
      const [row] = await db
        .insert(driveReferences)
        .values({
          driveObjectId,
          entityType,
          entityId,
          createdByUserId: auth.userId,
        })
        .returning();
      return c.json({ reference: row }, 201);
    } catch {
      return c.json({ error: "reference_exists" }, 409);
    }
  });

  app.delete("/references/:id", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.read) return c.json({ error: "forbidden_drive_read" }, 403);
    const id = c.req.param("id");

    const [existing] = await db
      .select({
        id: driveReferences.id,
        householdId: driveObjects.householdId,
        entityType: driveReferences.entityType,
        entityId: driveReferences.entityId,
      })
      .from(driveReferences)
      .innerJoin(driveObjects, eq(driveReferences.driveObjectId, driveObjects.id))
      .where(eq(driveReferences.id, id))
      .limit(1);

    if (!existing || existing.householdId !== auth.householdId) {
      return c.json({ error: "not_found" }, 404);
    }

    const canWriteEntity = await canWriteDriveReferenceEntity(
      db,
      auth,
      existing.entityType,
      existing.entityId,
    );
    if (!canWriteEntity) return c.json({ error: "forbidden_entity_write" }, 403);

    await db.delete(driveReferences).where(eq(driveReferences.id, id));
    return c.json({ ok: true });
  });

  return app;
}
