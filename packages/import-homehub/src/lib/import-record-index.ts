import { and, eq } from "drizzle-orm";
import type { createDb } from "@whome/db";
import { importRecords } from "@whome/db";

type Db = ReturnType<typeof createDb>;

function cacheKey(sourceTable: string, sourceId: string): string {
  return `${sourceTable}:${sourceId}`;
}

/** In-memory index of prior import rows — avoids N Postgres round-trips on re-import. */
export class ImportRecordIndex {
  private readonly map = new Map<string, string>();

  static async load(db: Db, householdId: string): Promise<ImportRecordIndex> {
    const index = new ImportRecordIndex();
    const rows = await db
      .select({
        sourceTable: importRecords.sourceTable,
        sourceId: importRecords.sourceId,
        targetId: importRecords.targetId,
      })
      .from(importRecords)
      .where(eq(importRecords.householdId, householdId));
    for (const row of rows) {
      index.map.set(cacheKey(row.sourceTable, row.sourceId), row.targetId);
    }
    return index;
  }

  get(sourceTable: string, sourceId: string): string | undefined {
    return this.map.get(cacheKey(sourceTable, sourceId));
  }

  remember(sourceTable: string, sourceId: string, targetId: string): void {
    this.map.set(cacheKey(sourceTable, sourceId), targetId);
  }

  get size(): number {
    return this.map.size;
  }
}

export async function lookupImportedTarget(
  db: Db,
  index: ImportRecordIndex | undefined,
  householdId: string,
  sourceTable: string,
  sourceId: string,
): Promise<string | null> {
  const cached = index?.get(sourceTable, sourceId);
  if (cached) return cached;

  const [existing] = await db
    .select({ targetId: importRecords.targetId })
    .from(importRecords)
    .where(
      and(
        eq(importRecords.householdId, householdId),
        eq(importRecords.sourceTable, sourceTable),
        eq(importRecords.sourceId, sourceId),
      ),
    )
    .limit(1);
  const targetId = existing?.targetId ?? null;
  if (targetId) index?.remember(sourceTable, sourceId, targetId);
  return targetId;
}

export function rememberImportedTarget(
  index: ImportRecordIndex | undefined,
  sourceTable: string,
  sourceId: string,
  targetId: string,
): void {
  index?.remember(sourceTable, sourceId, targetId);
}
