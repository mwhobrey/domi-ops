import { requireDb } from "../lib/require-db.js";
import { chores, importRecords } from "@whome/db";
import { and, eq } from "drizzle-orm";
import { sqliteTableExists } from "../lib/sqlite.js";
import type { ImportContext, MapperResult } from "./types.js";

export async function importTasks(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  if (!sqliteTableExists(ctx.sqlite, "chore")) {
    result.warnings.push("chore table not found — skipped");
    return result;
  }
  const rows = ctx.sqlite
    .prepare("SELECT id, description, done, due_date, creator, tags FROM chore")
    .all() as Record<string, unknown>[];

  if (ctx.dryRun) {
    let todoCount = 0;
    if (sqliteTableExists(ctx.sqlite, "todo_item")) {
      const todos = ctx.sqlite.prepare("SELECT COUNT(*) as c FROM todo_item").get() as {
        c: number;
      };
      todoCount = todos?.c ?? 0;
    }
    result.imported = rows.length + todoCount;
    result.warnings.push("dry-run: chores + todo_items counted");
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
  return result;
}
