import { createDb } from "@whome/db";
import { shoppingItems, importRecords } from "@whome/db";
import { and, eq } from "drizzle-orm";
import type { ImportContext, MapperResult } from "./types.js";

export async function importShopping(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  const rows = ctx.sqlite
    .prepare("SELECT id, item, checked, creator, tags FROM shopping_item")
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
          eq(importRecords.sourceTable, "shopping_item"),
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
      .insert(shoppingItems)
      .values({
        householdId: ctx.householdId,
        item: String(r.item),
        checked: Boolean(r.checked),
        tagsJson: String(r.tags ?? "[]"),
        createdByDisplayName: r.creator ? String(r.creator) : null,
      })
      .returning();
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "shopping_item",
      sourceId,
      targetTable: "shopping_items",
      targetId: row.id,
    });
    result.imported++;
  }
  return result;
}
