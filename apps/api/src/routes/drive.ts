import { randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { hashPassword, type AuthContext } from "@whome/auth";
import type { Env } from "@whome/config";
import type { Database } from "@whome/db";
import {
  driveFolders,
  driveObjects,
  driveReferences,
  driveShares,
  driveShareTokens,
  households,
  householdMembers,
} from "@whome/db";
import { and, desc, eq, exists, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { loadDriveEmbedObjects } from "../lib/drive-embeds.js";
import { normalizeFolderName } from "../lib/drive-folders.js";
import { computeDriveStorageStats } from "../lib/drive-storage.js";
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
  contentTypeFromKey,
} from "../lib/s3.js";
import { browserUploadPutUrl } from "../lib/upload-token.js";
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
  folderId?: string | null,
  scopeAllFolders?: boolean,
) {
  const conditions = [driveVisibleWhere(db, auth)];
  if (pinnedOnly) {
    conditions.push(eq(driveObjects.pinned, true));
  }
  const trimmedQ = q?.trim();
  const trimmedTag = tag?.trim();
  if (!trimmedQ && !trimmedTag && !pinnedOnly && !scopeAllFolders) {
    if (folderId) {
      conditions.push(eq(driveObjects.folderId, folderId));
    } else {
      conditions.push(isNull(driveObjects.folderId));
    }
  }
  if (trimmedQ) {
    conditions.push(
      or(
        ilike(driveObjects.title, `%${trimmedQ}%`),
        ilike(driveObjects.description, `%${trimmedQ}%`),
        ilike(driveObjects.s3Key, `%${trimmedQ}%`),
      ),
    );
  }
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

async function folderBelongsToHousehold(db: Database, householdId: string, folderId: string) {
  const [row] = await db
    .select({ id: driveFolders.id })
    .from(driveFolders)
    .where(and(eq(driveFolders.id, folderId), eq(driveFolders.householdId, householdId)))
    .limit(1);
  return Boolean(row);
}

async function isFolderDescendant(
  db: Database,
  folderId: string,
  candidateParentId: string,
): Promise<boolean> {
  let current: string | null = candidateParentId;
  while (current) {
    if (current === folderId) return true;
    const [row] = await db
      .select({ parentId: driveFolders.parentId })
      .from(driveFolders)
      .where(eq(driveFolders.id, current))
      .limit(1);
    current = row?.parentId ?? null;
  }
  return false;
}

function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
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
    const uploadUrl = browserUploadPutUrl(
      env,
      {
        uploadId: objectId,
        key,
        householdId: auth.householdId,
        memberId: auth.memberId,
        contentType,
        maxBytes: byteSize ?? env.DRIVE_UPLOAD_MAX_BYTES,
      },
      PRESIGN_EXPIRY_SEC,
    );
    return c.json({ uploadUrl, key, objectId });
  });

  app.get("/storage", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.read) return c.json({ error: "forbidden_drive_read" }, 403);
    const [row] = await db
      .select({
        storageQuotaBytes: households.storageQuotaBytes,
        storageUsedBytes: households.storageUsedBytes,
      })
      .from(households)
      .where(eq(households.id, auth.householdId))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(
      computeDriveStorageStats(row.storageUsedBytes, row.storageQuotaBytes, env),
    );
  });

  app.get("/glance", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.read) return c.json({ error: "forbidden_drive_read" }, 403);

    const pinnedRows = await db
      .select()
      .from(driveObjects)
      .where(driveListWhere(db, auth, undefined, undefined, true, undefined, true))
      .orderBy(desc(driveObjects.createdAt))
      .limit(4);

    let rows = pinnedRows;
    if (rows.length < 3) {
      const recentRows = await db
        .select()
        .from(driveObjects)
        .where(driveListWhere(db, auth, undefined, undefined, false, undefined, true))
        .orderBy(desc(driveObjects.createdAt))
        .limit(6);
      const seen = new Set(rows.map((r) => r.id));
      for (const row of recentRows) {
        if (seen.has(row.id)) continue;
        rows.push(row);
        seen.add(row.id);
        if (rows.length >= 3) break;
      }
    }

    const shareMap = await loadDriveShareMap(
      db,
      rows.filter((r) => r.visibility === "private").map((r) => r.id),
    );
    const items = rows.slice(0, 3).map((row) => serializeDriveObject(row, auth, shareMap));
    const pinnedCount = pinnedRows.length;
    const headline =
      pinnedCount > 0 ? `${pinnedCount} pinned` : items.length > 0 ? "Recent files" : "Empty";
    const tone = items.length > 0 ? "default" : ("success" as const);

    return c.json({
      enabled: true,
      summary: { headline, tone },
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        pinned: item.pinned,
      })),
      overflow: Math.max(0, rows.length - 3),
    });
  });

  app.get("/folders", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.read) return c.json({ error: "forbidden_drive_read" }, 403);
    const rows = await db
      .select({
        id: driveFolders.id,
        name: driveFolders.name,
        parentId: driveFolders.parentId,
        createdAt: driveFolders.createdAt,
      })
      .from(driveFolders)
      .where(eq(driveFolders.householdId, auth.householdId))
      .orderBy(driveFolders.name);
    return c.json({ folders: rows });
  });

  app.post("/folders", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.write) return c.json({ error: "forbidden_drive_write" }, 403);
    const body = await c.req.json<{ name?: string; parentId?: string | null }>();
    const name = normalizeFolderName(body.name);
    if (!name) return c.json({ error: "name_required" }, 400);
    if (body.parentId) {
      const valid = await folderBelongsToHousehold(db, auth.householdId, body.parentId);
      if (!valid) return c.json({ error: "invalid_parent" }, 400);
    }
    const [row] = await db
      .insert(driveFolders)
      .values({
        householdId: auth.householdId,
        parentId: body.parentId ?? null,
        name,
      })
      .returning();
    return c.json({ folder: row }, 201);
  });

  app.patch("/folders/:id", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.write) return c.json({ error: "forbidden_drive_write" }, 403);
    const id = c.req.param("id");
    const body = await c.req.json<{ name?: string; parentId?: string | null }>();

    const [existing] = await db
      .select()
      .from(driveFolders)
      .where(and(eq(driveFolders.id, id), eq(driveFolders.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const patch: Partial<typeof driveFolders.$inferInsert> = {};
    if (body.name !== undefined) {
      const name = normalizeFolderName(body.name);
      if (!name) return c.json({ error: "name_required" }, 400);
      patch.name = name;
    }
    if (body.parentId !== undefined) {
      if (body.parentId === id) return c.json({ error: "invalid_parent" }, 400);
      if (body.parentId) {
        const valid = await folderBelongsToHousehold(db, auth.householdId, body.parentId);
        if (!valid) return c.json({ error: "invalid_parent" }, 400);
        if (await isFolderDescendant(db, id, body.parentId)) {
          return c.json({ error: "invalid_parent" }, 400);
        }
      }
      patch.parentId = body.parentId;
    }
    if (Object.keys(patch).length === 0) return c.json({ error: "no_changes" }, 400);

    const [row] = await db
      .update(driveFolders)
      .set(patch)
      .where(and(eq(driveFolders.id, id), eq(driveFolders.householdId, auth.householdId)))
      .returning();
    return c.json({ folder: row });
  });

  app.delete("/folders/:id", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.write) return c.json({ error: "forbidden_drive_write" }, 403);
    const id = c.req.param("id");

    const [existing] = await db
      .select({ id: driveFolders.id })
      .from(driveFolders)
      .where(and(eq(driveFolders.id, id), eq(driveFolders.householdId, auth.householdId)))
      .limit(1);
    if (!existing) return c.json({ error: "not_found" }, 404);

    const [childFolder] = await db
      .select({ id: driveFolders.id })
      .from(driveFolders)
      .where(and(eq(driveFolders.parentId, id), eq(driveFolders.householdId, auth.householdId)))
      .limit(1);
    if (childFolder) return c.json({ error: "folder_not_empty" }, 409);

    const [childObject] = await db
      .select({ id: driveObjects.id })
      .from(driveObjects)
      .where(and(eq(driveObjects.folderId, id), eq(driveObjects.householdId, auth.householdId)))
      .limit(1);
    if (childObject) return c.json({ error: "folder_not_empty" }, 409);

    await db
      .delete(driveFolders)
      .where(and(eq(driveFolders.id, id), eq(driveFolders.householdId, auth.householdId)));
    return c.json({ ok: true });
  });

  app.get("/share-tokens", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.write) return c.json({ error: "forbidden_drive_write" }, 403);
    if (!env.DRIVE_PUBLIC_SHARES_ENABLED) {
      return c.json({ enabled: false, tokens: [] });
    }

    const rows = await db
      .select({
        id: driveShareTokens.id,
        token: driveShareTokens.token,
        expiresAt: driveShareTokens.expiresAt,
        revokedAt: driveShareTokens.revokedAt,
        createdAt: driveShareTokens.createdAt,
        hasPassword: sql<boolean>`${driveShareTokens.passwordHash} is not null`,
        objectId: driveObjects.id,
        objectTitle: driveObjects.title,
      })
      .from(driveShareTokens)
      .innerJoin(driveObjects, eq(driveShareTokens.driveObjectId, driveObjects.id))
      .where(
        and(
          eq(driveObjects.householdId, auth.householdId),
          isNull(driveShareTokens.revokedAt),
          or(isNull(driveShareTokens.expiresAt), sql`${driveShareTokens.expiresAt} > now()`),
        ),
      )
      .orderBy(desc(driveShareTokens.createdAt));

    return c.json({
      enabled: true,
      tokens: rows.map((row) => ({
        id: row.id,
        token: row.token,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        hasPassword: row.hasPassword,
        objectId: row.objectId,
        objectTitle: row.objectTitle,
        shareUrl: `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/s/${row.token}`,
      })),
    });
  });

  app.post("/objects/:id/share-tokens", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.write) return c.json({ error: "forbidden_drive_write" }, 403);
    if (!env.DRIVE_PUBLIC_SHARES_ENABLED) {
      return c.json({ error: "public_shares_disabled" }, 403);
    }

    const objectId = c.req.param("id");
    const body = await c.req.json<{
      expiresInDays?: number | null;
      password?: string | null;
    }>();

    const [object] = await db
      .select()
      .from(driveObjects)
      .where(and(eq(driveObjects.id, objectId), driveMutableWhere(objectId, auth)))
      .limit(1);
    if (!object || object.kind !== "file") {
      return c.json({ error: "not_found" }, 404);
    }

    let expiresAt: Date | null = null;
    if (body.expiresInDays != null && body.expiresInDays > 0) {
      expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000);
    }

    let passwordHash: string | null = null;
    const password = body.password?.trim();
    if (password) {
      passwordHash = await hashPassword(password);
    }

    const [row] = await db
      .insert(driveShareTokens)
      .values({
        driveObjectId: objectId,
        token: generateShareToken(),
        expiresAt,
        passwordHash,
      })
      .returning();

    return c.json(
      {
        token: {
          id: row.id,
          token: row.token,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
          hasPassword: Boolean(passwordHash),
          shareUrl: `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/s/${row.token}`,
        },
      },
      201,
    );
  });

  app.delete("/share-tokens/:id", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.write) return c.json({ error: "forbidden_drive_write" }, 403);
    const id = c.req.param("id");

    const [existing] = await db
      .select({
        tokenId: driveShareTokens.id,
        householdId: driveObjects.householdId,
      })
      .from(driveShareTokens)
      .innerJoin(driveObjects, eq(driveShareTokens.driveObjectId, driveObjects.id))
      .where(eq(driveShareTokens.id, id))
      .limit(1);
    if (!existing || existing.householdId !== auth.householdId) {
      return c.json({ error: "not_found" }, 404);
    }

    await db
      .update(driveShareTokens)
      .set({ revokedAt: new Date() })
      .where(eq(driveShareTokens.id, id));
    return c.json({ ok: true });
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
    const folderId = c.req.query("folderId")?.trim() || null;
    const scopeAll = c.req.query("all") === "1";
    const rows = await db
      .select()
      .from(driveObjects)
      .where(driveListWhere(db, auth, q, tag, pinnedOnly, folderId, scopeAll))
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

    if (body.folderId) {
      const validFolder = await folderBelongsToHousehold(db, auth.householdId, body.folderId);
      if (!validFolder) return c.json({ error: "invalid_folder" }, 400);
    }

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
      if (body.folderId) {
        const validFolder = await folderBelongsToHousehold(db, auth.householdId, body.folderId);
        if (!validFolder) return c.json({ error: "invalid_folder" }, 400);
      }
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

  app.get("/objects/resolve", async (c) => {
    const auth = c.get("auth")!;
    const access = await driveAccessForAuth(db, auth);
    if (!access.read) return c.json({ error: "forbidden_drive_read" }, 403);
    const ids = (c.req.query("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0) return c.json({ objects: {} });
    if (ids.length > 50) return c.json({ error: "too_many_ids" }, 400);
    const resolved = await loadDriveEmbedObjects(db, auth, ids);
    return c.json({ objects: Object.fromEntries(resolved) });
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
