import { importRecords, notices } from "@whome/db";
import { and, eq } from "drizzle-orm";
import { requireDb } from "../lib/require-db.js";
import { sqliteTableExists } from "../lib/sqlite.js";
import type { ImportContext, MapperResult } from "./types.js";

export async function importNotices(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  if (!sqliteTableExists(ctx.sqlite, "notice")) {
    result.warnings.push("notice table not found — skipped");
    return result;
  }

  const rows = ctx.sqlite
    .prepare("SELECT id, content, updated_by FROM notice ORDER BY id")
    .all() as Record<string, unknown>[];

  if (ctx.dryRun) {
    result.imported = rows.length;
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
          eq(importRecords.householdId, ctx.householdId),
          eq(importRecords.sourceTable, "notice"),
          eq(importRecords.sourceId, sourceId),
        ),
      )
      .limit(1);
    if (existing) {
      result.skipped++;
      continue;
    }
    const content = String(r.content ?? "");
    const [row] = await db
      .insert(notices)
      .values({
        householdId: ctx.householdId,
        content,
        updatedByDisplayName: r.updated_by ? String(r.updated_by) : null,
      })
      .returning();
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "notice",
      sourceId,
      targetTable: "notices",
      targetId: row.id,
    });
    result.imported++;
  }
  return result;
}
