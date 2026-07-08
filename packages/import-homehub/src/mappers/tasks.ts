import { requireDb } from "../lib/require-db.js";
import { chores, importRecords } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import { sqliteTableExists } from "../lib/sqlite.js";
import type { ImportContext, MapperResult } from "./types.js";

const LIST_PREFIX = "list:";

function choreTagsWithList(existingTagsJson: string, listName: string | null): string {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(existingTagsJson) as unknown;
    if (Array.isArray(parsed)) {
      tags = parsed.filter(
        (t): t is string => typeof t === "string" && !t.startsWith(LIST_PREFIX),
      );
    }
  } catch {
    // ignore invalid JSON
  }
  const parts: string[] = [];
  if (listName?.trim()) parts.push(`${LIST_PREFIX}${listName.trim()}`);
  for (const t of tags) {
    const trimmed = t.trim();
    if (trimmed) parts.push(trimmed);
  }
  return JSON.stringify(parts);
}

async function importChoreRows(ctx: ImportContext, result: MapperResult): Promise<void> {
  if (!sqliteTableExists(ctx.sqlite, "chore")) return;
  const rows = ctx.sqlite
    .prepare("SELECT id, description, done, due_date, creator, tags FROM chore")
    .all() as Record<string, unknown>[];
  const db = requireDb(ctx);

  for (const r of rows) {
    const sourceId = String(r.id);
    const [existing] = await db
      .select()
      .from(importRecords)
      .where(
        and(
          eq(importRecords.sourceTable, "chore"),
          eq(importRecords.sourceId, sourceId),
          eq(importRecords.householdId, ctx.householdId),
        ),
      )
      .limit(1);
    if (existing) {
      result.skipped++;
      continue;
    }
    const [row] = await db
      .insert(chores)
      .values({
        householdId: ctx.householdId,
        description: String(r.description),
        done: Boolean(r.done),
        dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
        tagsJson: String(r.tags ?? "[]"),
        createdByDisplayName: r.creator ? String(r.creator) : null,
      })
      .returning();
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "chore",
      sourceId,
      targetTable: "chores",
      targetId: row.id,
    });
    result.imported++;
  }
}

async function importTodoItems(ctx: ImportContext, result: MapperResult): Promise<void> {
  if (!sqliteTableExists(ctx.sqlite, "todo_item")) return;
  const db = requireDb(ctx);
  const hasLists = sqliteTableExists(ctx.sqlite, "todo_list");
  const rows = ctx.sqlite
    .prepare(
      hasLists
        ? `SELECT ti.id, ti.description, ti.done, ti.due_date, ti.creator, ti.tags, tl.name as list_name
           FROM todo_item ti
           LEFT JOIN todo_list tl ON tl.id = ti.todo_list_id
           ORDER BY ti.id`
        : `SELECT id, description, done, due_date, creator, tags FROM todo_item ORDER BY id`,
    )
    .all() as Record<string, unknown>[];

  for (const r of rows) {
    const sourceId = String(r.id);
    const [existing] = await db
      .select()
      .from(importRecords)
      .where(
        and(
          eq(importRecords.sourceTable, "todo_item"),
          eq(importRecords.sourceId, sourceId),
          eq(importRecords.householdId, ctx.householdId),
        ),
      )
      .limit(1);
    if (existing) {
      result.skipped++;
      continue;
    }
    const listName = hasLists ? (r.list_name ? String(r.list_name) : "Todos") : null;
    const desc = String(r.description);
    const [row] = await db
      .insert(chores)
      .values({
        householdId: ctx.householdId,
        description: desc,
        done: Boolean(r.done),
        dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
        tagsJson: choreTagsWithList(String(r.tags ?? "[]"), listName),
        createdByDisplayName: r.creator ? String(r.creator) : null,
      })
      .returning();
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "todo_item",
      sourceId,
      targetTable: "chores",
      targetId: row.id,
    });
    result.imported++;
  }
}

export async function importTasks(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  const hasChore = sqliteTableExists(ctx.sqlite, "chore");
  const hasTodo = sqliteTableExists(ctx.sqlite, "todo_item");
  if (!hasChore && !hasTodo) {
    result.warnings.push("chore and todo_item tables not found — skipped");
    return result;
  }

  if (ctx.dryRun) {
    let count = 0;
    if (hasChore) {
      const c = ctx.sqlite.prepare("SELECT COUNT(*) as n FROM chore").get() as { n: number };
      count += c?.n ?? 0;
    }
    if (hasTodo) {
      const t = ctx.sqlite.prepare("SELECT COUNT(*) as n FROM todo_item").get() as { n: number };
      count += t?.n ?? 0;
    }
    result.imported = count;
    return result;
  }

  await importChoreRows(ctx, result);
  await importTodoItems(ctx, result);
  return result;
}
