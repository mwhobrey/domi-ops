import { Hono } from "hono";
import type { Env } from "@domi-ops/config";
import type { Database } from "@domi-ops/db";
import { householdMembers, noteShares, notes } from "@domi-ops/db";
import { and, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import type { AuthContext } from "@domi-ops/auth";
import {
  driveEmbedsForContent,
  loadDriveEmbedObjects,
  parseDriveEmbedIds,
  type DriveEmbedDto,
} from "../lib/drive-embeds.js";
import { isHouseholdModuleEnabled } from "../lib/household-modules.js";
import {
  collectNoteTagSuggestions,
  normalizeNoteTitle,
  parseNoteTagsJson,
  serializeNoteTagsJson,
} from "../lib/notes.js";
import { buildNotesGlance } from "../lib/notes-glance.js";
import { posterLabel } from "../lib/poster-label.js";
import { loadEntityDriveAttachments, type DriveAttachmentDto } from "../lib/drive-attachments.js";
import type { AppVariables } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";

type NoteRow = typeof notes.$inferSelect;
type NoteVisibility = "private" | "household";

function normalizeNoteVisibility(value: unknown): NoteVisibility {
  return value === "private" ? "private" : "household";
}

function noteVisibleWhere(db: Database, auth: AuthContext) {
  return and(
    eq(notes.householdId, auth.householdId),
    or(
      eq(notes.visibility, "household"),
      and(eq(notes.visibility, "private"), eq(notes.createdByUserId, auth.userId)),
      and(
        eq(notes.visibility, "private"),
        exists(
          db
            .select({ noteId: noteShares.noteId })
            .from(noteShares)
            .where(
              and(eq(noteShares.noteId, notes.id), eq(noteShares.memberId, auth.memberId)),
            ),
        ),
      ),
    ),
  );
}

function noteMutableWhere(id: string, auth: AuthContext) {
  return and(
    eq(notes.id, id),
    eq(notes.householdId, auth.householdId),
    or(eq(notes.visibility, "household"), eq(notes.createdByUserId, auth.userId)),
  );
}

async function loadNoteShareMap(db: Database, noteIds: string[]) {
  const map = new Map<string, string[]>();
  if (noteIds.length === 0) return map;
  const rows = await db
    .select({ noteId: noteShares.noteId, memberId: noteShares.memberId })
    .from(noteShares)
    .where(inArray(noteShares.noteId, noteIds));
  for (const row of rows) {
    const list = map.get(row.noteId) ?? [];
    list.push(row.memberId);
    map.set(row.noteId, list);
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

async function replaceNoteShares(db: Database, noteId: string, memberIds: string[]) {
  await db.delete(noteShares).where(eq(noteShares.noteId, noteId));
  if (memberIds.length === 0) return;
  await db.insert(noteShares).values(
    memberIds.map((memberId) => ({
      noteId,
      memberId,
    })),
  );
}

function noteListWhere(db: Database, auth: AuthContext, q?: string, tag?: string) {
  const conditions = [noteVisibleWhere(db, auth)];
  const trimmedQ = q?.trim();
  if (trimmedQ) {
    conditions.push(
      or(ilike(notes.title, `%${trimmedQ}%`), ilike(notes.content, `%${trimmedQ}%`)),
    );
  }
  const trimmedTag = tag?.trim();
  if (trimmedTag) {
    conditions.push(
      sql`exists (
        select 1 from jsonb_array_elements_text(coalesce(${notes.tagsJson}::jsonb, '[]'::jsonb)) as note_tag
        where lower(note_tag) = lower(${trimmedTag})
      )`,
    );
  }
  return and(...conditions);
}

function serializeNote(
  row: NoteRow,
  auth: AuthContext,
  shareMap: Map<string, string[]>,
  attachmentMap?: Map<string, DriveAttachmentDto[]>,
  driveEmbedMap?: Map<string, DriveEmbedDto>,
  driveEnabled = false,
) {
  const sharedMemberIds = shareMap.get(row.id) ?? [];
  const isOwnedByMe = row.createdByUserId === auth.userId;
  const sharedWithMe =
    row.visibility === "private" &&
    !isOwnedByMe &&
    sharedMemberIds.includes(auth.memberId);
  const embedIds = driveEnabled ? parseDriveEmbedIds(row.content) : [];
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    pinned: row.pinned,
    tags: parseNoteTagsJson(row.tagsJson),
    visibility: row.visibility,
    createdByUserId: row.createdByUserId,
    createdByDisplayName: row.createdByDisplayName,
    createdAt: row.createdAt,
    isOwnedByMe,
    sharedWithMe,
    sharedMemberIds: isOwnedByMe ? sharedMemberIds : undefined,
    driveAttachments: attachmentMap?.get(row.id) ?? [],
    driveEmbeds:
      driveEnabled && embedIds.length > 0 && driveEmbedMap
        ? driveEmbedsForContent(row.content, driveEmbedMap)
        : undefined,
  };
}

export function notesRoutes(db: Database, env: Env) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use("*", requireAuth(env));

  app.get("/notes/glance", async (c) => {
    const auth = c.get("auth")!;
    const rows = await db
      .select({ id: notes.id, title: notes.title, pinned: notes.pinned })
      .from(notes)
      .where(noteListWhere(db, auth))
      .orderBy(desc(notes.pinned), desc(notes.createdAt))
      .limit(6);
    return c.json(buildNotesGlance(rows));
  });

  app.get("/notes/tag-suggestions", async (c) => {
    const auth = c.get("auth")!;
    const q = c.req.query("q")?.trim() ?? "";
    const suggestions = await collectNoteTagSuggestions(db, auth.householdId, q);
    return c.json({ suggestions });
  });

  app.get("/notes", async (c) => {
    const auth = c.get("auth")!;
    const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
    const q = c.req.query("q")?.trim();
    const tag = c.req.query("tag")?.trim();
    const rows = await db
      .select()
      .from(notes)
      .where(noteListWhere(db, auth, q, tag))
      .orderBy(desc(notes.pinned), desc(notes.createdAt))
      .limit(50);
    const shareMap = await loadNoteShareMap(
      db,
      rows.filter((r) => r.visibility === "private").map((r) => r.id),
    );
    const attachmentMap = driveEnabled
      ? await loadEntityDriveAttachments(
          db,
          auth,
          "note",
          rows.map((r) => r.id),
        )
      : undefined;
    const embedIds = driveEnabled
      ? [...new Set(rows.flatMap((row) => parseDriveEmbedIds(row.content)))]
      : [];
    const driveEmbedMap =
      driveEnabled && embedIds.length > 0
        ? await loadDriveEmbedObjects(db, auth, embedIds)
        : undefined;
    return c.json({
      notes: rows.map((row) =>
        serializeNote(row, auth, shareMap, attachmentMap, driveEmbedMap, driveEnabled),
      ),
    });
  });

  app.post("/notes", async (c) => {
    const auth = c.get("auth")!;
    const body = await c.req.json<{
      title: string;
      content: string;
      pinned?: boolean;
      tags?: string[];
      visibility?: NoteVisibility;
      sharedMemberIds?: string[];
    }>();
    const title = normalizeNoteTitle(body.title);
    if (!title) return c.json({ error: "title_required" }, 400);
    const content = body.content?.trim();
    if (!content) return c.json({ error: "content_required" }, 400);
    const visibility = normalizeNoteVisibility(body.visibility);
    const [row] = await db
      .insert(notes)
      .values({
        householdId: auth.householdId,
        title,
        content,
        pinned: Boolean(body.pinned),
        tagsJson: serializeNoteTagsJson(body.tags ?? []),
        visibility,
        createdByUserId: auth.userId,
        createdByDisplayName: posterLabel(auth),
      })
      .returning();
    let sharedMemberIds: string[] = [];
    if (visibility === "private" && Array.isArray(body.sharedMemberIds)) {
      sharedMemberIds = await validateShareMemberIds(
        db,
        auth.householdId,
        body.sharedMemberIds,
        auth.memberId,
      );
      await replaceNoteShares(db, row.id, sharedMemberIds);
    }
    const shareMap = new Map<string, string[]>([[row.id, sharedMemberIds]]);
    const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
    const embedIds = driveEnabled ? parseDriveEmbedIds(row.content) : [];
    const driveEmbedMap =
      driveEnabled && embedIds.length > 0
        ? await loadDriveEmbedObjects(db, auth, embedIds)
        : undefined;
    return c.json(
      { note: serializeNote(row, auth, shareMap, undefined, driveEmbedMap, driveEnabled) },
      201,
    );
  });

  app.patch("/notes/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const body = await c.req.json<{
      title?: string;
      content?: string;
      pinned?: boolean;
      tags?: string[];
      visibility?: NoteVisibility;
      sharedMemberIds?: string[];
    }>();
    const patch: Partial<typeof notes.$inferInsert> = {};
    if (body.title !== undefined) {
      const title = normalizeNoteTitle(body.title);
      if (!title) return c.json({ error: "title_required" }, 400);
      patch.title = title;
    }
    if (body.content !== undefined) {
      const content = body.content.trim();
      if (!content) return c.json({ error: "content_required" }, 400);
      patch.content = content;
    }
    if (body.pinned !== undefined) {
      patch.pinned = Boolean(body.pinned);
    }
    if (body.tags !== undefined) {
      patch.tagsJson = serializeNoteTagsJson(body.tags);
    }
    if (body.visibility !== undefined) {
      const visibility = normalizeNoteVisibility(body.visibility);
      patch.visibility = visibility;
      if (visibility === "private") {
        patch.createdByUserId = auth.userId;
      }
    }
    const hasShareUpdate = body.sharedMemberIds !== undefined;
    if (Object.keys(patch).length === 0 && !hasShareUpdate) {
      return c.json({ error: "no_changes" }, 400);
    }
    const [row] =
      Object.keys(patch).length > 0
        ? await db
            .update(notes)
            .set(patch)
            .where(noteMutableWhere(id, auth))
            .returning()
        : await db
            .select()
            .from(notes)
            .where(noteMutableWhere(id, auth))
            .limit(1);
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.visibility === "household") {
      await replaceNoteShares(db, row.id, []);
    } else if (hasShareUpdate) {
      const sharedMemberIds = await validateShareMemberIds(
        db,
        auth.householdId,
        body.sharedMemberIds ?? [],
        auth.memberId,
      );
      await replaceNoteShares(db, row.id, sharedMemberIds);
    }
    const shareMap = await loadNoteShareMap(db, row.visibility === "private" ? [row.id] : []);
    const driveEnabled = await isHouseholdModuleEnabled(db, env, auth.householdId, "drive");
    const embedIds = driveEnabled ? parseDriveEmbedIds(row.content) : [];
    const driveEmbedMap =
      driveEnabled && embedIds.length > 0
        ? await loadDriveEmbedObjects(db, auth, embedIds)
        : undefined;
    return c.json({
      note: serializeNote(row, auth, shareMap, undefined, driveEmbedMap, driveEnabled),
    });
  });

  app.delete("/notes/:id", async (c) => {
    const auth = c.get("auth")!;
    const id = c.req.param("id");
    const [row] = await db
      .delete(notes)
      .where(noteMutableWhere(id, auth))
      .returning({ id: notes.id });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
