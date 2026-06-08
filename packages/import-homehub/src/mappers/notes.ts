import { requireDb } from "../lib/require-db.js";
import { notes, importRecords } from "@whome/db";
import { and, eq } from "drizzle-orm";
import { sqliteTableExists, sqliteSelectExisting } from "../lib/sqlite.js";
import type { ImportContext, MapperResult } from "./types.js";

const NOTE_COLUMNS = [
  "id",
  "title",
  "content",
  "creator",
  "timestamp",
  "tags",
  "visibility",
] as const;

function parseImportedNoteTags(raw: unknown): string {
  if (raw == null || raw === "") return "[]";
  const s = String(raw).trim();
  if (s.startsWith("[")) return s;
  return JSON.stringify(
    s
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

function parseImportedNoteVisibility(raw: unknown): "household" | "private" {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "private" ? "private" : "household";
}

function parseImportedNoteTimestamp(raw: unknown): Date | undefined {
  if (raw == null || raw === "") return undefined;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function deriveImportedNoteTitle(rawTitle: unknown, content: string): string {
  const explicit = String(rawTitle ?? "").trim();
  if (explicit) return explicit.slice(0, 256);
  const firstLine =
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  if (firstLine) return firstLine.slice(0, 256);
  const trimmed = content.trim();
  if (trimmed) return trimmed.slice(0, 256);
  return "Untitled";
}

export async function importNotes(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  if (!sqliteTableExists(ctx.sqlite, "note")) {
    result.warnings.push("note table not found — skipped");
    return result;
  }

  const rows = sqliteSelectExisting(
    ctx.sqlite,
    "note",
    [...NOTE_COLUMNS],
    " ORDER BY id",
  );

  if (ctx.dryRun) {
    const count = (
      ctx.sqlite.prepare("SELECT COUNT(*) as n FROM note").get() as { n: number }
    ).n;
    result.imported = count;
    return result;
  }

  const db = requireDb(ctx);
  for (const r of rows) {
    const sourceId = String(r.id);
    const [existing] = await db
      .select()
      .from(importRecords)
      .where(
        and(
          eq(importRecords.sourceTable, "note"),
          eq(importRecords.sourceId, sourceId),
          eq(importRecords.householdId, ctx.householdId),
        ),
      )
      .limit(1);
    if (existing) {
      result.skipped++;
      continue;
    }

    const content = String(r.content ?? "");
    const values: typeof notes.$inferInsert = {
      householdId: ctx.householdId,
      title: deriveImportedNoteTitle(r.title, content),
      content,
      createdByDisplayName: r.creator ? String(r.creator) : null,
    };

    if (r.tags !== undefined) {
      values.tagsJson = parseImportedNoteTags(r.tags);
    }
    if (r.visibility !== undefined) {
      values.visibility = parseImportedNoteVisibility(r.visibility);
    } else {
      values.visibility = "household";
    }

    const createdAt = parseImportedNoteTimestamp(r.timestamp);
    if (createdAt) {
      values.createdAt = createdAt;
    }

    const [row] = await db.insert(notes).values(values).returning();
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "note",
      sourceId,
      targetTable: "notes",
      targetId: row.id,
    });
    result.imported++;
  }
  return result;
}
