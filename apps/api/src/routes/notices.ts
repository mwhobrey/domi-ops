import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import {
  driveObjects,
  driveReferences,
  noticeReads,
  notices,
  userNotifications,
} from "@domi-ops/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { AuthContext } from "@domi-ops/auth";
import { driveVisibleWhere } from "../lib/drive.js";
import { isHouseholdModuleEnabled } from "../lib/household-modules.js";
import { notifyHouseholdOfNotice } from "../lib/push-notices.js";
import { posterLabel } from "../lib/poster-label.js";
import { loadEntityDriveAttachments, type DriveAttachmentDto } from "../lib/drive-attachments.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

type NoticeRow = typeof notices.$inferSelect;

async function mapNoticesForUser(
  db: Database,
  auth: AuthContext,
  rows: NoticeRow[],
  includeAttachments: boolean,
) {
  if (rows.length === 0) return [];
  const reads = await db
    .select({ noticeId: noticeReads.noticeId })
    .from(noticeReads)
    .where(eq(noticeReads.userId, auth.userId));
  const readSet = new Set(reads.map((r) => r.noticeId));

  const attachmentMap = includeAttachments
    ? await loadEntityDriveAttachments(
        db,
        auth,
        "notice",
        rows.map((n) => n.id),
      )
    : new Map<string, DriveAttachmentDto[]>();

  return rows.map((n) => {
    const isOwn = n.postedByUserId === auth.userId;
    const read = isOwn || readSet.has(n.id);
    return {
      id: n.id,
      content: n.content,
      postedByUserId: n.postedByUserId,
      postedByDisplayName: n.updatedByDisplayName,
      createdAt: (n.createdAt ?? n.updatedAt).toISOString(),
      read,
      isOwn,
      attachments: attachmentMap.get(n.id) ?? [],
    };
  });
}

function countUnread(
  userId: string,
  mapped: { isOwn: boolean; read: boolean }[],
): number {
  return mapped.filter((n) => !n.isOwn && !n.read).length;
}

export function noticesRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/notices", async (c) => {
    const auth = c.get("auth")!;
    const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
    const rows = await db
      .select()
      .from(notices)
      .where(eq(notices.householdId, auth.householdId))
      .orderBy(desc(notices.createdAt), desc(notices.updatedAt))
      .limit(50);
    const mapped = await mapNoticesForUser(db, auth, rows, driveEnabled);
    const unreadCount = countUnread(auth.userId, mapped);
    const latest = mapped[0] ?? null;
    return c.json({ notices: mapped, unreadCount, latest });
  });

  app.get("/notices/unread-count", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(notices)
      .where(eq(notices.householdId, auth.householdId))
      .orderBy(desc(notices.createdAt), desc(notices.updatedAt))
      .limit(50);
    const mapped = await mapNoticesForUser(db, auth, rows, false);
    return c.json({ unreadCount: countUnread(auth.userId, mapped) });
  });

  app.get("/notifications", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select()
      .from(userNotifications)
      .where(eq(userNotifications.userId, auth.userId))
      .orderBy(desc(userNotifications.createdAt))
      .limit(50);
    const unreadCount = rows.filter((r) => r.readAt == null).length;
    return c.json({
      notifications: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        url: r.url,
        tag: r.tag,
        read: r.readAt != null,
        createdAt: r.createdAt.toISOString(),
      })),
      unreadCount,
    });
  });

  app.get("/notifications/unread-count", async (c) => {
    const auth = c.get("auth")!;
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userNotifications)
      .where(
        and(eq(userNotifications.userId, auth.userId), sql`${userNotifications.readAt} IS NULL`),
      );
    return c.json({ unreadCount: Number(row?.count ?? 0) });
  });

  app.post("/notifications/mark-read", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ ids?: string[]; all?: boolean }>();
    const now = new Date();
    if (body.all) {
      await db
        .update(userNotifications)
        .set({ readAt: now })
        .where(
          and(eq(userNotifications.userId, auth.userId), sql`${userNotifications.readAt} IS NULL`),
        );
      return c.json({ ok: true });
    }
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
    if (ids.length === 0) return c.json({ error: "ids_required" }, 400);
    await db
      .update(userNotifications)
      .set({ readAt: now })
      .where(
        and(eq(userNotifications.userId, auth.userId), inArray(userNotifications.id, ids)),
      );
    return c.json({ ok: true });
  });

  app.post("/notices", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{ content: string; driveObjectIds?: string[] }>();
    const content = (body.content ?? "").trim();
    if (!content) return c.json({ error: "content_required" }, 400);
    const now = new Date();
    const label = posterLabel(auth);
    const [row] = await db
      .insert(notices)
      .values({
        householdId: auth.householdId,
        content,
        postedByUserId: auth.userId,
        updatedByDisplayName: label,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await db
      .insert(noticeReads)
      .values({ noticeId: row.id, userId: auth.userId })
      .onConflictDoNothing({ target: [noticeReads.noticeId, noticeReads.userId] });

    const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
    if (driveEnabled && Array.isArray(body.driveObjectIds) && body.driveObjectIds.length > 0) {
      const uniqueIds = [...new Set(body.driveObjectIds.map((id) => id.trim()).filter(Boolean))];
      for (const objectId of uniqueIds) {
        const [object] = await db
          .select({ id: driveObjects.id })
          .from(driveObjects)
          .where(and(eq(driveObjects.id, objectId), driveVisibleWhere(db, auth)))
          .limit(1);
        if (!object) continue;
        try {
          await db.insert(driveReferences).values({
            driveObjectId: objectId,
            entityType: "notice",
            entityId: row.id,
            createdByUserId: auth.userId,
          });
        } catch {
          /* duplicate reference — skip */
        }
      }
    }

    const [mapped] = await mapNoticesForUser(db, auth, [row], driveEnabled);
    void notifyHouseholdOfNotice(db, env, {
      householdId: auth.householdId,
      posterUserId: auth.userId,
      noticeId: row.id,
      content,
      posterDisplayName: label,
    }).catch((err) => {
      if (env.NODE_ENV === "development") {
        console.error("[domi-ops] notice push failed", err);
      }
    });
    return c.json({ notice: mapped }, 201);
  });

  app.post("/notices/:id/read", async (c) => {
    const auth = c.get("auth")!;
    const noticeId = c.req.param("id");
    const [row] = await db
      .select()
      .from(notices)
      .where(and(eq(notices.id, noticeId), eq(notices.householdId, auth.householdId)))
      .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    await db
      .insert(noticeReads)
      .values({ noticeId, userId: auth.userId })
      .onConflictDoNothing({ target: [noticeReads.noticeId, noticeReads.userId] });
    return c.json({ ok: true });
  });

  app.post("/notices/read-all", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select({ id: notices.id, postedByUserId: notices.postedByUserId })
      .from(notices)
      .where(eq(notices.householdId, auth.householdId));
    const toMark = rows.filter((n) => n.postedByUserId !== auth.userId);
    if (toMark.length > 0) {
      await db
        .insert(noticeReads)
        .values(toMark.map((n) => ({ noticeId: n.id, userId: auth.userId })))
        .onConflictDoNothing({ target: [noticeReads.noticeId, noticeReads.userId] });
    }
    return c.json({ ok: true });
  });

  return app;
}
