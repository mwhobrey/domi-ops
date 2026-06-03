import { createDb } from "@whome/db";
import { notes, importRecords } from "@whome/db";
import { and, eq } from "drizzle-orm";
import type { ImportContext, MapperResult } from "./types.js";

export async function importNotes(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  const rows = ctx.sqlite
    .prepare("SELECT id, content, creator FROM note")
    .all() as Record<string, unknown>[];

  if (ctx.dryRun) {
    result.imported = rows.length;
    return result;
  }

  const db = createDb(ctx.databaseUrl);
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
    const [row] = await db
      .insert(notes)
      .values({
        householdId: ctx.householdId,
        content: String(r.content),
        createdByDisplayName: r.creator ? String(r.creator) : null,
      })
      .returning();
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
