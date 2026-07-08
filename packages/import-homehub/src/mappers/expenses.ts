import { requireDb } from "../lib/require-db.js";
import { expenses, importRecords } from "@domi-ops/db";
import { and, eq } from "drizzle-orm";
import type { ImportContext, MapperResult } from "./types.js";

export async function importExpenses(ctx: ImportContext): Promise<MapperResult> {
  const result: MapperResult = { imported: 0, skipped: 0, warnings: [] };
  let rows: Record<string, unknown>[] = [];
  try {
    rows = ctx.sqlite
      .prepare(
        "SELECT id, title, amount, category, date, creator FROM expense LIMIT 5000",
      )
      .all() as Record<string, unknown>[];
  } catch {
    result.warnings.push("expense table not found in SQLite — skipped");
    return result;
  }

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
          eq(importRecords.sourceTable, "expense"),
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
      .insert(expenses)
      .values({
        householdId: ctx.householdId,
        title: String(r.title ?? "Expense"),
        amount: Number(r.amount ?? 0),
        category: r.category ? String(r.category) : null,
        expenseDate: String(r.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
        createdByDisplayName: r.creator ? String(r.creator) : null,
      })
      .returning();
    await db.insert(importRecords).values({
      householdId: ctx.householdId,
      sourceTable: "expense",
      sourceId,
      targetTable: "expenses",
      targetId: row.id,
    });
    result.imported++;
  }
  return result;
}
